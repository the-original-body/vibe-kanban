//! GitHub-related API routes.

use std::path::PathBuf;

use axum::{Json, Router, extract::Query, extract::State, response::Json as ResponseJson, routing::{get, post}};
use db::models::project::{CreateProject, Project};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use services::services::git_host::github::{GhCli, GhCliError, GitHubOrgRepoInfo};
use services::services::project::ProjectServiceError;
use ts_rs::TS;
use utils::response::ApiResponse;

use crate::{DeploymentImpl, error::ApiError};

// ============================================================================
// Clone and Create Project Endpoint
// ============================================================================

/// Request body for cloning a GitHub repository and creating a project.
#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct CloneAndCreateProjectRequest {
    /// Full name of the GitHub repository (e.g., "org/repo")
    pub repo_full_name: String,
    /// Destination path where the repository will be cloned
    pub destination_path: String,
    /// Optional custom name for the project (defaults to repo name)
    pub project_name: Option<String>,
}

/// Clone a GitHub repository and create a vibe-kanban project in one operation.
///
/// This endpoint:
/// 1. Validates the destination path (parent must exist, destination must not)
/// 2. Clones the repository using `gh repo clone`
/// 3. Creates a project with the cloned repository
pub async fn clone_and_create_project(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CloneAndCreateProjectRequest>,
) -> Result<ResponseJson<ApiResponse<Project>>, ApiError> {
    let destination = PathBuf::from(&payload.destination_path);

    // Validate: parent directory must exist
    let parent = destination.parent().ok_or_else(|| {
        ApiError::BadRequest("Invalid destination path: no parent directory".to_string())
    })?;

    if !parent.exists() {
        return Err(ApiError::BadRequest(format!(
            "Parent directory does not exist: {}",
            parent.display()
        )));
    }

    if !parent.is_dir() {
        return Err(ApiError::BadRequest(format!(
            "Parent path is not a directory: {}",
            parent.display()
        )));
    }

    // Validate: destination must not already exist
    if destination.exists() {
        return Err(ApiError::BadRequest(format!(
            "Destination already exists: {}",
            destination.display()
        )));
    }

    // Clone using `gh repo clone`
    let output = tokio::process::Command::new("gh")
        .arg("repo")
        .arg("clone")
        .arg(&payload.repo_full_name)
        .arg(&destination)
        .output()
        .await
        .map_err(|e| {
            ApiError::BadRequest(format!(
                "Failed to execute gh command: {}. Is GitHub CLI installed?",
                e
            ))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Clean up partial clone if it exists
        if destination.exists() {
            let _ = tokio::fs::remove_dir_all(&destination).await;
        }
        return Err(ApiError::BadRequest(format!(
            "Failed to clone repository: {}",
            stderr.trim()
        )));
    }

    // Derive project name from repo_full_name or use provided name
    let project_name = payload.project_name.unwrap_or_else(|| {
        payload
            .repo_full_name
            .split('/')
            .last()
            .unwrap_or(&payload.repo_full_name)
            .to_string()
    });

    // Create the project using existing ProjectService
    let create_payload = CreateProject {
        name: project_name,
        repositories: vec![db::models::project_repo::CreateProjectRepo {
            display_name: payload
                .repo_full_name
                .split('/')
                .last()
                .unwrap_or(&payload.repo_full_name)
                .to_string(),
            git_repo_path: destination.to_string_lossy().to_string(),
        }],
    };

    match deployment
        .project()
        .create_project(&deployment.db().pool, deployment.repo(), create_payload)
        .await
    {
        Ok(project) => {
            // Track project creation event
            deployment
                .track_if_analytics_allowed(
                    "project_created",
                    serde_json::json!({
                        "project_id": project.id.to_string(),
                        "repository_count": 1,
                        "trigger": "github_clone",
                    }),
                )
                .await;

            tracing::info!(
                "Created project '{}' from GitHub repo '{}' at '{}'",
                project.name,
                payload.repo_full_name,
                destination.display()
            );

            Ok(ResponseJson(ApiResponse::success(project)))
        }
        Err(ProjectServiceError::DuplicateGitRepoPath) => {
            // Clean up cloned repo since project creation failed
            let _ = tokio::fs::remove_dir_all(&destination).await;
            Ok(ResponseJson(ApiResponse::error(
                "A project with this repository path already exists",
            )))
        }
        Err(e) => {
            // Clean up cloned repo since project creation failed
            let _ = tokio::fs::remove_dir_all(&destination).await;
            Err(e.into())
        }
    }
}

// ============================================================================
// List Organization Repos Endpoint
// ============================================================================

/// Query parameters for listing GitHub org repositories.
#[derive(Debug, Deserialize)]
pub struct ListOrgReposQuery {
    /// The GitHub organization name (required).
    pub org: String,
    /// Optional search filter - filters repos where name contains this string (case-insensitive).
    pub search: Option<String>,
}

/// A repository from a GitHub organization.
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GitHubOrgRepo {
    pub name: String,
    pub description: Option<String>,
    pub clone_url: String,
}

impl From<GitHubOrgRepoInfo> for GitHubOrgRepo {
    fn from(info: GitHubOrgRepoInfo) -> Self {
        Self {
            name: info.name,
            description: info.description,
            clone_url: info.clone_url,
        }
    }
}

/// Error types for GitHub org repos endpoint.
#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(tag = "type", rename_all = "snake_case")]
pub enum GitHubOrgReposError {
    CliNotInstalled,
    AuthFailed { message: String },
    CommandFailed { message: String },
}

/// List repositories from a GitHub organization.
///
/// Uses `gh repo list {org}` to fetch repos, filters out archived ones,
/// and optionally filters by search term.
pub async fn list_org_repos(
    Query(query): Query<ListOrgReposQuery>,
) -> ResponseJson<ApiResponse<Vec<GitHubOrgRepo>, GitHubOrgReposError>> {
    let gh_cli = GhCli::new();

    // Run gh repo list in a blocking task since it shells out
    let org = query.org.clone();
    let result = tokio::task::spawn_blocking(move || gh_cli.list_org_repos(&org)).await;

    // Handle join error
    let cli_result = match result {
        Ok(r) => r,
        Err(e) => {
            return ResponseJson(ApiResponse::error_with_data(
                GitHubOrgReposError::CommandFailed {
                    message: format!("Task execution failed: {e}"),
                },
            ));
        }
    };

    match cli_result {
        Ok(repos) => {
            // Filter by search term if provided (case-insensitive)
            let filtered: Vec<GitHubOrgRepo> = repos
                .into_iter()
                .map(GitHubOrgRepo::from)
                .filter(|repo| {
                    if let Some(ref search) = query.search {
                        repo.name.to_lowercase().contains(&search.to_lowercase())
                    } else {
                        true
                    }
                })
                .collect();

            ResponseJson(ApiResponse::success(filtered))
        }
        Err(GhCliError::NotAvailable) => ResponseJson(ApiResponse::error_with_data(
            GitHubOrgReposError::CliNotInstalled,
        )),
        Err(GhCliError::AuthFailed(message)) => ResponseJson(ApiResponse::error_with_data(
            GitHubOrgReposError::AuthFailed { message },
        )),
        Err(GhCliError::CommandFailed(message)) | Err(GhCliError::UnexpectedOutput(message)) => {
            ResponseJson(ApiResponse::error_with_data(
                GitHubOrgReposError::CommandFailed { message },
            ))
        }
    }
}

// ============================================================================
// Router
// ============================================================================

pub fn router(_deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    Router::new().nest(
        "/github",
        Router::new()
            .route("/clone-and-create-project", post(clone_and_create_project))
            .route("/repos", get(list_org_repos)),
    )
}
