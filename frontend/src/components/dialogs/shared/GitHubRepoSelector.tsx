import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertCircle,
  ArrowLeft,
  Folder,
  Loader2,
  Search,
} from 'lucide-react';
import { githubApi, GitHubOrgRepo, GitHubOrgReposError } from '@/lib/api';
import { FolderPickerDialog } from './FolderPickerDialog';

// Hardcoded org as per requirements
const GITHUB_ORG = 'the-original-body';

export interface GitHubRepoSelectorProps {
  onBack: () => void;
  onClone: (repoFullName: string, destinationPath: string) => Promise<void>;
  isCloning: boolean;
  disabled?: boolean;
}

export function GitHubRepoSelector({
  onBack,
  onClone,
  isCloning,
  disabled = false,
}: GitHubRepoSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [repos, setRepos] = useState<GitHubOrgRepo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [selectedRepo, setSelectedRepo] = useState<GitHubOrgRepo | null>(null);
  const [destinationPath, setDestinationPath] = useState('');

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Load repos when component mounts or search changes
  const loadRepos = useCallback(async (search?: string) => {
    setIsLoading(true);
    setError('');

    const result = await githubApi.listOrgRepos(GITHUB_ORG, search);

    if (result.success) {
      setRepos(result.data);
    } else {
      const errorData = result.error as GitHubOrgReposError | undefined;
      if (errorData) {
        switch (errorData.type) {
          case 'cli_not_installed':
            setError(
              'GitHub CLI (gh) is not installed. Please install it from https://cli.github.com/'
            );
            break;
          case 'auth_failed':
            setError(
              `GitHub authentication failed: ${errorData.message}. Run "gh auth login" to authenticate.`
            );
            break;
          case 'command_failed':
            setError(`Failed to list repositories: ${errorData.message}`);
            break;
        }
      } else {
        setError(result.message || 'Failed to load repositories');
      }
      setRepos([]);
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadRepos(debouncedSearch || undefined);
  }, [debouncedSearch, loadRepos]);

  const handleSelectRepo = (repo: GitHubOrgRepo) => {
    setSelectedRepo(repo);
    setError('');
  };

  const handleBrowseDestination = async () => {
    const selectedPath = await FolderPickerDialog.show({
      title: 'Select Clone Destination',
      description: 'Choose where to clone the repository',
      value: destinationPath,
    });
    if (selectedPath) {
      setDestinationPath(selectedPath);
    }
  };

  const handleClone = async () => {
    if (!selectedRepo || !destinationPath.trim()) return;

    const repoFullName = `${GITHUB_ORG}/${selectedRepo.name}`;
    // Append repo name to destination path
    const fullDestination = destinationPath.endsWith('/')
      ? `${destinationPath}${selectedRepo.name}`
      : `${destinationPath}/${selectedRepo.name}`;

    await onClone(repoFullName, fullDestination);
  };

  const canClone = useMemo(
    () => selectedRepo && destinationPath.trim() && !isCloning && !disabled,
    [selectedRepo, destinationPath, isCloning, disabled]
  );

  // If a repo is selected, show the destination picker
  if (selectedRepo) {
    return (
      <>
        <button
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
          onClick={() => setSelectedRepo(null)}
          disabled={isCloning}
        >
          <ArrowLeft className="h-3 w-3" />
          Back to repository list
        </button>

        <div className="p-4 border rounded-lg bg-card">
          <div className="font-medium text-foreground">{selectedRepo.name}</div>
          {selectedRepo.description && (
            <div className="text-xs text-muted-foreground mt-1">
              {selectedRepo.description}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="destination-path">
            Clone Destination <span className="text-red-500">*</span>
          </Label>
          <div className="flex space-x-2">
            <Input
              id="destination-path"
              type="text"
              value={destinationPath}
              onChange={(e) => setDestinationPath(e.target.value)}
              placeholder="Select a folder..."
              className="flex-1"
              disabled={isCloning}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={isCloning}
              onClick={handleBrowseDestination}
            >
              <Folder className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The repository will be cloned to: {destinationPath ? `${destinationPath}/${selectedRepo.name}` : '...'}
          </p>
        </div>

        <Button
          onClick={handleClone}
          disabled={!canClone}
          className="w-full"
        >
          {isCloning ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Cloning & Creating Project...
            </>
          ) : (
            'Clone & Create Project'
          )}
        </Button>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </>
    );
  }

  // Show the repo list
  return (
    <>
      <button
        className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
        onClick={onBack}
        disabled={disabled}
      >
        <ArrowLeft className="h-3 w-3" />
        Back to options
      </button>

      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search repositories..."
          className="pl-10"
          disabled={disabled}
        />
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="p-4 border rounded-lg bg-card">
          <div className="flex items-center gap-3">
            <div className="animate-spin h-5 w-5 border-2 border-muted-foreground border-t-transparent rounded-full" />
            <div className="text-sm text-muted-foreground">
              Loading repositories...
            </div>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !isLoading && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Repos list */}
      {!isLoading && !error && repos.length > 0 && (
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {repos.map((repo) => (
            <div
              key={repo.name}
              className="p-4 border cursor-pointer hover:shadow-md transition-shadow rounded-lg bg-card"
              onClick={() => !disabled && handleSelectRepo(repo)}
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
                  <div className="font-medium text-foreground">{repo.name}</div>
                  {repo.description && (
                    <div className="text-xs text-muted-foreground truncate mt-1">
                      {repo.description}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && repos.length === 0 && (
        <div className="p-4 border rounded-lg bg-card">
          <div className="flex items-start gap-3">
            <Folder className="h-5 w-5 mt-0.5 flex-shrink-0 text-muted-foreground" />
            <div>
              <div className="text-sm text-muted-foreground">
                No repositories found
              </div>
              {searchQuery && (
                <div className="text-xs text-muted-foreground mt-1">
                  Try a different search term
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
