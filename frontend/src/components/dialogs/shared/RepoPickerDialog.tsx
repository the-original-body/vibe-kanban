import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertCircle,
  ArrowLeft,
  Folder,
  FolderGit,
  FolderPlus,
  Loader2,
  Search,
} from 'lucide-react';
import { fileSystemApi, repoApi, githubApi } from '@/lib/api';
import { DirectoryEntry, Project, Repo } from 'shared/types';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/lib/modals';
import { FolderPickerDialog } from './FolderPickerDialog';
import { GitHubRepoSelector } from './GitHubRepoSelector';

export interface RepoPickerDialogProps {
  value?: string;
  title?: string;
  description?: string;
}

/**
 * Result when GitHub clone creates a project directly.
 */
export interface GitHubCloneResult {
  type: 'github_clone';
  project: Project;
}

/**
 * Result type for RepoPickerDialog.
 * - Repo: A repository was selected/created, caller should create a project
 * - GitHubCloneResult: GitHub clone completed and project was already created by backend
 * - null: Dialog was cancelled
 */
export type RepoPickerResult = Repo | GitHubCloneResult | null;

/**
 * Type guard to check if result is a GitHub clone result.
 */
export function isGitHubCloneResult(
  result: RepoPickerResult
): result is GitHubCloneResult {
  return result !== null && 'type' in result && result.type === 'github_clone';
}

/**
 * Type guard to check if result is a Repo.
 */
export function isRepoResult(result: RepoPickerResult): result is Repo {
  return result !== null && !('type' in result);
}

type Stage = 'options' | 'existing' | 'new' | 'github';

const RepoPickerDialogImpl = NiceModal.create<RepoPickerDialogProps>(
  ({
    title = 'Select Repository',
    description = 'Choose or create a git repository',
  }) => {
    const { t } = useTranslation('projects');
    const modal = useModal();
    const [stage, setStage] = useState<Stage>('options');
    const [error, setError] = useState('');
    const [isWorking, setIsWorking] = useState(false);

    // Stage: existing
    const [allRepos, setAllRepos] = useState<DirectoryEntry[]>([]);
    const [reposLoading, setReposLoading] = useState(false);
    const [showMoreRepos, setShowMoreRepos] = useState(false);
    const [loadingDuration, setLoadingDuration] = useState(0);
    const [hasSearched, setHasSearched] = useState(false);

    // Stage: new
    const [repoName, setRepoName] = useState('');
    const [parentPath, setParentPath] = useState('');

    // Stage: github
    const [isCloning, setIsCloning] = useState(false);

    useEffect(() => {
      if (modal.visible) {
        setStage('options');
        setError('');
        setAllRepos([]);
        setShowMoreRepos(false);
        setRepoName('');
        setParentPath('');
        setLoadingDuration(0);
        setHasSearched(false);
        setIsCloning(false);
      }
    }, [modal.visible]);

    const loadRecentRepos = useCallback(async () => {
      setReposLoading(true);
      setError('');
      setLoadingDuration(0);
      try {
        const repos = await fileSystemApi.listGitRepos();
        setAllRepos(repos);
      } catch (err) {
        setError('Failed to load repositories');
        console.error('Failed to load repos:', err);
      } finally {
        setReposLoading(false);
        setHasSearched(true);
      }
    }, []);

    useEffect(() => {
      if (
        stage === 'existing' &&
        allRepos.length === 0 &&
        !reposLoading &&
        !hasSearched
      ) {
        loadRecentRepos();
      }
    }, [stage, allRepos.length, reposLoading, hasSearched, loadRecentRepos]);

    // Track loading duration to show timeout message
    useEffect(() => {
      if (!reposLoading) {
        return;
      }

      const interval = setInterval(() => {
        setLoadingDuration((prev) => prev + 1);
      }, 1000);

      return () => clearInterval(interval);
    }, [reposLoading]);

    const registerAndReturn = async (path: string) => {
      setIsWorking(true);
      setError('');
      try {
        const repo = await repoApi.register({ path });
        modal.resolve(repo);
        modal.hide();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to register repository'
        );
      } finally {
        setIsWorking(false);
      }
    };

    const handleSelectRepo = (repo: DirectoryEntry) => {
      registerAndReturn(repo.path);
    };

    const handleBrowseForRepo = async () => {
      setError('');
      const selectedPath = await FolderPickerDialog.show({
        title: 'Select Git Repository',
        description: 'Choose an existing git repository',
      });
      if (selectedPath) {
        registerAndReturn(selectedPath);
      }
    };

    const handleCreateRepo = async () => {
      if (!repoName.trim()) {
        setError('Repository name is required');
        return;
      }

      setIsWorking(true);
      setError('');
      try {
        const repo = await repoApi.init({
          parent_path: parentPath.trim() || '.',
          folder_name: repoName.trim(),
        });
        modal.resolve(repo);
        modal.hide();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to create repository'
        );
      } finally {
        setIsWorking(false);
      }
    };

    const handleCancel = () => {
      modal.resolve(null);
      modal.hide();
    };

    const handleOpenChange = (open: boolean) => {
      if (!open && !isWorking && !isCloning) {
        handleCancel();
      }
    };

    const goBack = () => {
      setStage('options');
      setError('');
    };

    const handleGitHubClone = async (
      repoFullName: string,
      destinationPath: string
    ) => {
      setIsCloning(true);
      setError('');
      try {
        // Clone the repo and create the project in one operation
        // The backend already creates the project, so we return it directly
        const project = await githubApi.cloneAndCreateProject({
          repo_full_name: repoFullName,
          destination_path: destinationPath,
        });
        // Return the created project - caller should NOT create another project
        modal.resolve({ type: 'github_clone', project });
        modal.hide();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to clone repository'
        );
      } finally {
        setIsCloning(false);
      }
    };

    return (
      <div className="fixed inset-0 z-[10000] pointer-events-none [&>*]:pointer-events-auto">
        <Dialog open={modal.visible} onOpenChange={handleOpenChange}>
          <DialogContent className="max-w-[500px] w-full">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Stage: Options */}
              {stage === 'options' && (
                <>
                  <div
                    className="p-4 border cursor-pointer hover:shadow-md transition-shadow rounded-lg bg-card"
                    onClick={() => setStage('existing')}
                  >
                    <div className="flex items-start gap-3">
                      <FolderGit className="h-5 w-5 mt-0.5 flex-shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-foreground">
                          From Git Repository
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Select an existing repository from your system
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    className="p-4 border cursor-pointer hover:shadow-md transition-shadow rounded-lg bg-card"
                    onClick={() => setStage('new')}
                  >
                    <div className="flex items-start gap-3">
                      <FolderPlus className="h-5 w-5 mt-0.5 flex-shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-foreground">
                          Create New Repository
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Initialize a new git repository
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    className="p-4 border cursor-pointer hover:shadow-md transition-shadow rounded-lg bg-card"
                    onClick={() => setStage('github')}
                  >
                    <div className="flex items-start gap-3">
                      <svg
                        className="h-5 w-5 mt-0.5 flex-shrink-0 text-muted-foreground"
                        fill="currentColor"
                        viewBox="0 0 16 16"
                      >
                        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                      </svg>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-foreground">
                          Clone from GitHub
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Clone a repository from GitHub
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Stage: Existing */}
              {stage === 'existing' && (
                <>
                  <button
                    className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
                    onClick={goBack}
                    disabled={isWorking}
                  >
                    <ArrowLeft className="h-3 w-3" />
                    Back to options
                  </button>

                  {reposLoading && (
                    <div className="p-4 border rounded-lg bg-card">
                      <div className="flex items-center gap-3">
                        <div className="animate-spin h-5 w-5 border-2 border-muted-foreground border-t-transparent rounded-full" />
                        <div className="text-sm text-muted-foreground">
                          {loadingDuration < 2
                            ? t('repoSearch.searching')
                            : t('repoSearch.stillSearching', {
                                seconds: loadingDuration,
                              })}
                        </div>
                      </div>
                      {loadingDuration >= 3 && (
                        <div className="text-xs text-muted-foreground mt-2 ml-8">
                          {t('repoSearch.takingLonger')}
                        </div>
                      )}
                    </div>
                  )}

                  {!reposLoading && allRepos.length > 0 && (
                    <div className="space-y-2">
                      {allRepos
                        .slice(0, showMoreRepos ? allRepos.length : 3)
                        .map((repo) => (
                          <div
                            key={repo.path}
                            className="p-4 border cursor-pointer hover:shadow-md transition-shadow rounded-lg bg-card"
                            onClick={() => !isWorking && handleSelectRepo(repo)}
                          >
                            <div className="flex items-start gap-3">
                              <FolderGit className="h-5 w-5 mt-0.5 flex-shrink-0 text-muted-foreground" />
                              <div className="min-w-0 flex-1">
                                <div className="font-medium text-foreground">
                                  {repo.name}
                                </div>
                                <div className="text-xs text-muted-foreground truncate mt-1">
                                  {repo.path}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}

                      {!showMoreRepos && allRepos.length > 3 && (
                        <button
                          className="text-sm text-muted-foreground hover:text-foreground transition-colors text-left"
                          onClick={() => setShowMoreRepos(true)}
                        >
                          Show {allRepos.length - 3} more repositories
                        </button>
                      )}
                      {showMoreRepos && allRepos.length > 3 && (
                        <button
                          className="text-sm text-muted-foreground hover:text-foreground transition-colors text-left"
                          onClick={() => setShowMoreRepos(false)}
                        >
                          Show less
                        </button>
                      )}
                    </div>
                  )}

                  {/* No repos found state */}
                  {!reposLoading &&
                    hasSearched &&
                    allRepos.length === 0 &&
                    !error && (
                      <div className="p-4 border rounded-lg bg-card">
                        <div className="flex items-start gap-3">
                          <Folder className="h-5 w-5 mt-0.5 flex-shrink-0 text-muted-foreground" />
                          <div>
                            <div className="text-sm text-muted-foreground">
                              {t('repoSearch.noReposFound')}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {t('repoSearch.browseHint')}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                  <div
                    className="p-4 border border-dashed cursor-pointer hover:shadow-md transition-shadow rounded-lg bg-card"
                    onClick={() => !isWorking && handleBrowseForRepo()}
                  >
                    <div className="flex items-start gap-3">
                      <Search className="h-5 w-5 mt-0.5 flex-shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-foreground">
                          Browse for repository
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Browse and select any repository on your system
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Stage: New */}
              {stage === 'new' && (
                <>
                  <button
                    className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
                    onClick={goBack}
                    disabled={isWorking}
                  >
                    <ArrowLeft className="h-3 w-3" />
                    Back to options
                  </button>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="repo-name">
                        Repository Name <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="repo-name"
                        type="text"
                        value={repoName}
                        onChange={(e) => setRepoName(e.target.value)}
                        placeholder="my-project"
                        disabled={isWorking}
                      />
                      <p className="text-xs text-muted-foreground">
                        This will be the folder name for your new repository
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="parent-path">Parent Directory</Label>
                      <div className="flex space-x-2">
                        <Input
                          id="parent-path"
                          type="text"
                          value={parentPath}
                          onChange={(e) => setParentPath(e.target.value)}
                          placeholder="Current Directory"
                          className="flex-1"
                          disabled={isWorking}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={isWorking}
                          onClick={async () => {
                            const selectedPath = await FolderPickerDialog.show({
                              title: 'Select Parent Directory',
                              description:
                                'Choose where to create the new repository',
                              value: parentPath,
                            });
                            if (selectedPath) {
                              setParentPath(selectedPath);
                            }
                          }}
                        >
                          <Folder className="h-4 w-4" />
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Leave empty to use your current working directory
                      </p>
                    </div>

                    <Button
                      onClick={handleCreateRepo}
                      disabled={isWorking || !repoName.trim()}
                      className="w-full"
                    >
                      {isWorking ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        'Create Repository'
                      )}
                    </Button>
                  </div>
                </>
              )}

              {/* Stage: GitHub */}
              {stage === 'github' && (
                <GitHubRepoSelector
                  onBack={goBack}
                  onClone={handleGitHubClone}
                  isCloning={isCloning}
                  disabled={isWorking}
                />
              )}

              {error && stage !== 'github' && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {isWorking && stage === 'existing' && (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Registering repository...
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }
);

export const RepoPickerDialog = defineModal<
  RepoPickerDialogProps,
  RepoPickerResult
>(RepoPickerDialogImpl);
