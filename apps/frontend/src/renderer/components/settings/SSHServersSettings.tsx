/**
 * SSHServersSettings - Display and manage SSH servers for remote projects
 *
 * Shows all configured SSH servers with an "Add Server" button.
 * Displays empty state when no servers exist.
 * Allows adding, editing, testing connections, and deleting servers.
 */
import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Server, Pencil, Wifi, WifiOff, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { SSHServerEditDialog } from './SSHServerEditDialog';
import { cn } from '../../lib/utils';
import { useToast } from '../../hooks/use-toast';
import type { SSHServer } from '@shared/types/ssh';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '../ui/alert-dialog';

export function SSHServersSettings() {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [servers, setServers] = useState<SSHServer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editServer, setEditServer] = useState<SSHServer | null>(null);
  const [deleteConfirmServer, setDeleteConfirmServer] = useState<SSHServer | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [testingServerId, setTestingServerId] = useState<string | null>(null);

  // Load servers on mount
  const loadServers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const result = await window.electronAPI.listSSHServers();
    if (result.success && result.data) {
      setServers(result.data);
    } else {
      setError(result.error || 'Failed to load SSH servers');
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  const handleDeleteServer = async () => {
    if (!deleteConfirmServer) return;

    setIsDeleting(true);
    const result = await window.electronAPI.removeSSHServer(deleteConfirmServer.id);
    setIsDeleting(false);

    if (result.success) {
      toast({
        title: t('settings:sshServers.toast.delete.title'),
        description: t('settings:sshServers.toast.delete.description', {
          name: deleteConfirmServer.name
        }),
      });
      setDeleteConfirmServer(null);
      loadServers();
    } else {
      toast({
        variant: 'destructive',
        title: t('settings:sshServers.toast.delete.errorTitle'),
        description: result.error || t('settings:sshServers.toast.delete.errorFallback'),
      });
    }
  };

  const handleTestConnection = async (server: SSHServer) => {
    setTestingServerId(server.id);
    const result = await window.electronAPI.testSSHConnection(server.id);
    setTestingServerId(null);

    if (result.success && result.data) {
      const testResult = result.data;
      if (testResult.success) {
        toast({
          title: t('settings:sshServers.toast.test.successTitle'),
          description: t('settings:sshServers.toast.test.successDescription', {
            name: server.name,
            latency: testResult.latencyMs || 0
          }),
        });
      } else {
        toast({
          variant: 'destructive',
          title: t('settings:sshServers.toast.test.errorTitle'),
          description: t('settings:sshServers.toast.test.errorDescription', {
            error: testResult.error || testResult.message
          }),
        });
      }
    } else {
      toast({
        variant: 'destructive',
        title: t('settings:sshServers.toast.test.errorTitle'),
        description: result.error || 'Connection test failed',
      });
    }
  };

  const handleServerSaved = () => {
    loadServers();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 border border-dashed rounded-lg border-destructive">
        <p className="text-sm text-destructive">{error}</p>
        <Button onClick={loadServers} variant="outline" className="mt-4">
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with Add button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{t('settings:sshServers.title')}</h3>
          <p className="text-sm text-muted-foreground">
            {t('settings:sshServers.description')}
          </p>
        </div>
        <Button onClick={() => setIsAddDialogOpen(true)} size="sm">
          <Plus className="h-4 w-4 mr-2" />
          {t('settings:sshServers.addButton')}
        </Button>
      </div>

      {/* Empty state */}
      {servers.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 px-4 border border-dashed rounded-lg">
          <Server className="h-12 w-12 text-muted-foreground mb-4" />
          <h4 className="text-lg font-medium mb-2">{t('settings:sshServers.empty.title')}</h4>
          <p className="text-sm text-muted-foreground text-center max-w-sm mb-4">
            {t('settings:sshServers.empty.description')}
          </p>
          <Button onClick={() => setIsAddDialogOpen(true)} variant="outline">
            <Plus className="h-4 w-4 mr-2" />
            {t('settings:sshServers.empty.action')}
          </Button>
        </div>
      )}

      {/* Server list */}
      {servers.length > 0 && (
        <div className="space-y-2">
          {servers.map((server) => {
            const isTesting = testingServerId === server.id;
            return (
              <div
                key={server.id}
                className={cn(
                  'flex items-center justify-between p-4 rounded-lg border transition-colors',
                  'border-border hover:bg-accent/50'
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Server className="h-4 w-4 text-muted-foreground" />
                    <h4 className="font-medium truncate">{server.name}</h4>
                  </div>
                  <p className="text-sm text-muted-foreground truncate">
                    {server.user ? `${server.user}@` : ''}{server.host}:{server.port || 22}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {/* Test Connection */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleTestConnection(server)}
                        disabled={isTesting}
                      >
                        {isTesting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Wifi className="h-4 w-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {isTesting
                        ? t('settings:sshServers.testConnection.testing')
                        : t('settings:sshServers.testConnection.label')}
                    </TooltipContent>
                  </Tooltip>

                  {/* Edit */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditServer(server)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('settings:sshServers.actions.edit')}</TooltipContent>
                  </Tooltip>

                  {/* Delete */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteConfirmServer(server)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('settings:sshServers.actions.delete')}</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <SSHServerEditDialog
        open={isAddDialogOpen || !!editServer}
        onOpenChange={(open) => {
          if (!open) {
            setIsAddDialogOpen(false);
            setEditServer(null);
          }
        }}
        server={editServer}
        onSaved={handleServerSaved}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteConfirmServer}
        onOpenChange={(open) => !open && setDeleteConfirmServer(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('settings:sshServers.deleteConfirm.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings:sshServers.deleteConfirm.description', {
                name: deleteConfirmServer?.name
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:buttons.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteServer}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('common:buttons.deleting')}
                </>
              ) : (
                t('settings:sshServers.actions.delete')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
