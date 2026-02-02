import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, FolderPlus, ChevronRight, Server, Settings } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './ui/select';
import { cn } from '../lib/utils';
import { addProject } from '../stores/project-store';
import { RemoteFileBrowser } from './settings/RemoteFileBrowser';
import type { Project } from '../../shared/types';
import type { SSHServer } from '@shared/types/ssh';

type ModalStep = 'choose' | 'create-form' | 'remote-browse';

interface AddProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProjectAdded?: (project: Project, needsInit: boolean) => void;
  onOpenSettings?: () => void;
}

export function AddProjectModal({ open, onOpenChange, onProjectAdded, onOpenSettings }: AddProjectModalProps) {
  const { t } = useTranslation('dialogs');
  const [step, setStep] = useState<ModalStep>('choose');
  const [projectName, setProjectName] = useState('');
  const [projectLocation, setProjectLocation] = useState('');
  const [initGit, setInitGit] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Remote project state
  const [sshServers, setSshServers] = useState<SSHServer[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [selectedRemotePath, setSelectedRemotePath] = useState<string | null>(null);
  const [isLoadingServers, setIsLoadingServers] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setStep('choose');
      setProjectName('');
      setProjectLocation('');
      setInitGit(true);
      setError(null);
      setSelectedServerId(null);
      setSelectedRemotePath(null);
    }
  }, [open]);

  // Load default location on mount
  useEffect(() => {
    const loadDefaultLocation = async () => {
      try {
        const defaultDir = await window.electronAPI.getDefaultProjectLocation();
        if (defaultDir) {
          setProjectLocation(defaultDir);
        }
      } catch {
        // Ignore - will just be empty
      }
    };
    loadDefaultLocation();
  }, []);

  // Load SSH servers when going to remote step
  useEffect(() => {
    if (step === 'remote-browse') {
      loadSshServers();
    }
  }, [step]);

  const loadSshServers = async () => {
    setIsLoadingServers(true);
    try {
      const result = await window.electronAPI.listSSHServers();
      if (result.success && result.data) {
        setSshServers(result.data);
        if (result.data.length > 0 && !selectedServerId) {
          setSelectedServerId(result.data[0].id);
        }
      }
    } catch {
      // Ignore
    } finally {
      setIsLoadingServers(false);
    }
  };

  const handleOpenExisting = async () => {
    try {
      const path = await window.electronAPI.selectDirectory();
      if (path) {
        const project = await addProject(path);
        if (project) {
          // Auto-detect and save the main branch for the project
          try {
            const mainBranchResult = await window.electronAPI.detectMainBranch(path);
            if (mainBranchResult.success && mainBranchResult.data) {
              await window.electronAPI.updateProjectSettings(project.id, {
                mainBranch: mainBranchResult.data
              });
            }
          } catch {
            // Non-fatal - main branch can be set later in settings
          }
          onProjectAdded?.(project, !project.autoBuildPath);
          onOpenChange(false);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('addProject.failedToOpen'));
    }
  };

  const handleSelectLocation = async () => {
    try {
      const path = await window.electronAPI.selectDirectory();
      if (path) {
        setProjectLocation(path);
      }
    } catch {
      // User cancelled - ignore
    }
  };

  const handleCreateProject = async () => {
    if (!projectName.trim()) {
      setError(t('addProject.nameRequired'));
      return;
    }
    if (!projectLocation.trim()) {
      setError(t('addProject.locationRequired'));
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      // Create the project folder
      const result = await window.electronAPI.createProjectFolder(
        projectLocation,
        projectName.trim(),
        initGit
      );

      if (!result.success || !result.data) {
        setError(result.error || 'Failed to create project folder');
        return;
      }

      // Add the project to our store
      const project = await addProject(result.data.path);
      if (project) {
        // For new projects with git init, set main branch
        // Git init creates 'main' branch by default on modern git
        if (initGit) {
          try {
            const mainBranchResult = await window.electronAPI.detectMainBranch(result.data.path);
            if (mainBranchResult.success && mainBranchResult.data) {
              await window.electronAPI.updateProjectSettings(project.id, {
                mainBranch: mainBranchResult.data
              });
            }
          } catch {
            // Non-fatal - main branch can be set later in settings
          }
        }
        onProjectAdded?.(project, true); // New projects always need init
        onOpenChange(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('addProject.failedToCreate'));
    } finally {
      setIsCreating(false);
    }
  };

  const handleAddRemoteProject = async () => {
    if (!selectedServerId || !selectedRemotePath) {
      setError(t('remoteProject.selectDirectory'));
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const project = await addProject(selectedRemotePath, {
        serverId: selectedServerId,
        remotePath: selectedRemotePath
      });

      if (project) {
        onProjectAdded?.(project, true); // Remote projects need init check
        onOpenChange(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('addProject.failedToOpen'));
    } finally {
      setIsCreating(false);
    }
  };

  const handleRemotePathSelect = (path: string) => {
    setSelectedRemotePath(path);
  };

  const renderChooseStep = () => (
    <>
      <DialogHeader>
        <DialogTitle>{t('addProject.title')}</DialogTitle>
        <DialogDescription>
          {t('addProject.description')}
        </DialogDescription>
      </DialogHeader>

      <div className="py-4 space-y-3">
        {/* Open Existing Option */}
        <button
          onClick={handleOpenExisting}
          className={cn(
            'w-full flex items-center gap-4 p-4 rounded-xl border border-border',
            'bg-card hover:bg-accent hover:border-accent transition-all duration-200',
            'text-left group'
          )}
          aria-label={t('addProject.openExistingAriaLabel')}
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <FolderOpen className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-foreground">{t('addProject.openExisting')}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('addProject.openExistingDescription')}
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
        </button>

        {/* Create New Option */}
        <button
          onClick={() => setStep('create-form')}
          className={cn(
            'w-full flex items-center gap-4 p-4 rounded-xl border border-border',
            'bg-card hover:bg-accent hover:border-accent transition-all duration-200',
            'text-left group'
          )}
          aria-label={t('addProject.createNewAriaLabel')}
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-success/10">
            <FolderPlus className="h-6 w-6 text-success" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-foreground">{t('addProject.createNew')}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('addProject.createNewDescription')}
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
        </button>

        {/* Open Remote Option */}
        <button
          onClick={() => setStep('remote-browse')}
          className={cn(
            'w-full flex items-center gap-4 p-4 rounded-xl border border-border',
            'bg-card hover:bg-accent hover:border-accent transition-all duration-200',
            'text-left group'
          )}
          aria-label={t('addProject.openRemoteAriaLabel', 'Open remote project via SSH')}
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
            <Server className="h-6 w-6 text-blue-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-foreground">{t('addProject.openRemote', 'Open Remote Project')}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('addProject.openRemoteDescription', 'Work on a project hosted on a remote SSH server')}
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
        </button>
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3 mt-2" role="alert">
          {error}
        </div>
      )}
    </>
  );

  const renderCreateForm = () => (
    <>
      <DialogHeader>
        <DialogTitle>{t('addProject.createNewTitle')}</DialogTitle>
        <DialogDescription>
          {t('addProject.createNewSubtitle')}
        </DialogDescription>
      </DialogHeader>

      <div className="py-4 space-y-4">
        {/* Project Name */}
        <div className="space-y-2">
          <Label htmlFor="project-name">{t('addProject.projectName')}</Label>
          <Input
            id="project-name"
            placeholder={t('addProject.projectNamePlaceholder')}
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            {t('addProject.projectNameHelp')}
          </p>
        </div>

        {/* Location */}
        <div className="space-y-2">
          <Label htmlFor="project-location">{t('addProject.location')}</Label>
          <div className="flex gap-2">
            <Input
              id="project-location"
              placeholder={t('addProject.locationPlaceholder')}
              value={projectLocation}
              onChange={(e) => setProjectLocation(e.target.value)}
              className="flex-1"
            />
            <Button variant="outline" onClick={handleSelectLocation}>
              {t('addProject.browse')}
            </Button>
          </div>
          {projectLocation && projectName && (
            <p className="text-xs text-muted-foreground">
              {t('addProject.willCreate')} <code className="bg-muted px-1 py-0.5 rounded">{projectLocation}/{projectName}</code>
            </p>
          )}
        </div>

        {/* Git Init Checkbox */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="init-git"
            checked={initGit}
            onChange={(e) => setInitGit(e.target.checked)}
            className="h-4 w-4 rounded border-border bg-background"
          />
          <Label htmlFor="init-git" className="text-sm font-normal cursor-pointer">
            {t('addProject.initGit')}
          </Label>
        </div>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3" role="alert">
            {error}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => setStep('choose')} disabled={isCreating}>
          {t('addProject.back')}
        </Button>
        <Button onClick={handleCreateProject} disabled={isCreating}>
          {isCreating ? t('addProject.creating') : t('addProject.createProject')}
        </Button>
      </DialogFooter>
    </>
  );

  const renderRemoteBrowse = () => (
    <>
      <DialogHeader>
        <DialogTitle>{t('remoteProject.title')}</DialogTitle>
        <DialogDescription>
          {t('remoteProject.description')}
        </DialogDescription>
      </DialogHeader>

      <div className="py-4 space-y-4">
        {isLoadingServers ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading servers...
          </div>
        ) : sshServers.length === 0 ? (
          <div className="text-center py-8">
            <Server className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-medium text-foreground mb-2">{t('remoteProject.noServers')}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t('remoteProject.noServersDescription')}
            </p>
            {onOpenSettings && (
              <Button
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  onOpenSettings();
                }}
              >
                <Settings className="mr-2 h-4 w-4" />
                {t('remoteProject.goToSettings')}
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Server Selection */}
            <div className="space-y-2">
              <Label>{t('remoteProject.selectServer')}</Label>
              <Select
                value={selectedServerId || ''}
                onValueChange={setSelectedServerId}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('remoteProject.selectServerPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {sshServers.map((server) => (
                    <SelectItem key={server.id} value={server.id}>
                      {server.name} ({server.host})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Remote File Browser */}
            {selectedServerId && (
              <div className="space-y-2">
                <Label>{t('remoteProject.selectDirectory')}</Label>
                <RemoteFileBrowser
                  serverId={selectedServerId}
                  onSelect={handleRemotePathSelect}
                  className="h-80"
                />
              </div>
            )}

            {/* Selected Path Display */}
            {selectedRemotePath && (
              <div className="text-sm text-muted-foreground">
                Selected: <code className="bg-muted px-1 py-0.5 rounded">{selectedRemotePath}</code>
              </div>
            )}
          </>
        )}

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3" role="alert">
            {error}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => setStep('choose')} disabled={isCreating}>
          {t('addProject.back')}
        </Button>
        <Button
          onClick={handleAddRemoteProject}
          disabled={isCreating || !selectedServerId || !selectedRemotePath}
        >
          {isCreating ? t('addProject.creating') : t('remoteProject.addProject')}
        </Button>
      </DialogFooter>
    </>
  );

  const renderStep = () => {
    switch (step) {
      case 'choose':
        return renderChooseStep();
      case 'create-form':
        return renderCreateForm();
      case 'remote-browse':
        return renderRemoteBrowse();
      default:
        return renderChooseStep();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('sm:max-w-md', step === 'remote-browse' && 'sm:max-w-lg')}>
        {renderStep()}
      </DialogContent>
    </Dialog>
  );
}
