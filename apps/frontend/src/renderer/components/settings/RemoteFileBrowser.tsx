/**
 * RemoteFileBrowser - Browse remote directories via SFTP
 *
 * Allows navigation of remote file system on SSH servers.
 * Used for selecting project directories on remote servers.
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Folder,
  FolderOpen,
  ChevronRight,
  Home,
  Loader2,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';
import type { RemoteDirectoryEntry } from '@shared/types/ssh';

interface RemoteFileBrowserProps {
  serverId: string;
  onSelect: (path: string) => void;
  initialPath?: string;
  showHidden?: boolean;
  className?: string;
}

interface BreadcrumbSegment {
  name: string;
  path: string;
}

export function RemoteFileBrowser({
  serverId,
  onSelect,
  initialPath,
  showHidden = false,
  className
}: RemoteFileBrowserProps) {
  const { t } = useTranslation('dialogs');

  const [currentPath, setCurrentPath] = useState<string>('/');
  const [entries, setEntries] = useState<RemoteDirectoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // Parse path into breadcrumb segments
  const breadcrumbs: BreadcrumbSegment[] = [
    { name: 'Home', path: '~' }
  ];

  if (currentPath && currentPath !== '~') {
    const parts = currentPath.split('/').filter(Boolean);
    let accumulatedPath = '';
    for (const part of parts) {
      accumulatedPath += '/' + part;
      breadcrumbs.push({
        name: part,
        path: accumulatedPath
      });
    }
  }

  // Load home directory on mount
  useEffect(() => {
    const loadHomeDirectory = async () => {
      if (!serverId) return;

      try {
        const result = await window.electronAPI.getRemoteHomeDirectory(serverId);
        if (result.success && result.data) {
          const homePath = initialPath || result.data;
          setCurrentPath(homePath);
        }
      } catch {
        setCurrentPath('/');
      }
    };

    loadHomeDirectory();
  }, [serverId, initialPath]);

  // Load directory contents
  const loadDirectory = useCallback(async (path: string) => {
    if (!serverId) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.listRemoteDirectory(
        serverId,
        path,
        { showHidden, directoriesOnly: true }
      );

      if (result.success && result.data) {
        // Sort: directories first, then alphabetically
        const sorted = [...result.data].sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });
        setEntries(sorted);
      } else {
        setError(result.error || t('remoteFileBrowser.loadError'));
        setEntries([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('remoteFileBrowser.loadError'));
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, [serverId, showHidden, t]);

  // Reload when path changes
  useEffect(() => {
    if (currentPath) {
      loadDirectory(currentPath);
    }
  }, [currentPath, loadDirectory]);

  const handleNavigate = (path: string) => {
    setSelectedPath(null);
    setCurrentPath(path);
  };

  const handleEntryClick = (entry: RemoteDirectoryEntry) => {
    if (entry.isDirectory) {
      setSelectedPath(entry.path);
    }
  };

  const handleEntryDoubleClick = (entry: RemoteDirectoryEntry) => {
    if (entry.isDirectory) {
      handleNavigate(entry.path);
    }
  };

  const handleSelect = () => {
    if (selectedPath) {
      onSelect(selectedPath);
    } else {
      onSelect(currentPath);
    }
  };

  const handleRefresh = () => {
    loadDirectory(currentPath);
  };

  return (
    <div className={cn('flex flex-col border border-border rounded-lg', className)}>
      {/* Breadcrumb navigation */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-muted/30">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => handleNavigate('~')}
          title={t('remoteFileBrowser.home')}
        >
          <Home className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-1 flex-1 overflow-x-auto">
          {breadcrumbs.map((segment, index) => (
            <div key={segment.path} className="flex items-center">
              {index > 0 && (
                <ChevronRight className="h-4 w-4 text-muted-foreground mx-1" />
              )}
              <button
                onClick={() => handleNavigate(segment.path)}
                className={cn(
                  'text-sm px-2 py-1 rounded hover:bg-accent transition-colors whitespace-nowrap',
                  index === breadcrumbs.length - 1
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {segment.name}
              </button>
            </div>
          ))}
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleRefresh}
          disabled={isLoading}
          title={t('remoteFileBrowser.refresh')}
        >
          <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
        </Button>
      </div>

      {/* Directory listing */}
      <ScrollArea className="h-64">
        {isLoading && entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span>{t('remoteFileBrowser.loading')}</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-destructive p-4">
            <AlertCircle className="h-6 w-6 mb-2" />
            <span className="text-sm text-center">{error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              className="mt-3"
            >
              {t('remoteFileBrowser.retry')}
            </Button>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <span>{t('remoteFileBrowser.empty')}</span>
          </div>
        ) : (
          <div className="p-2">
            {entries.map((entry) => (
              <button
                key={entry.path}
                onClick={() => handleEntryClick(entry)}
                onDoubleClick={() => handleEntryDoubleClick(entry)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors',
                  selectedPath === entry.path
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent/50'
                )}
              >
                {selectedPath === entry.path ? (
                  <FolderOpen className="h-5 w-5 text-primary shrink-0" />
                ) : (
                  <Folder className="h-5 w-5 text-muted-foreground shrink-0" />
                )}
                <span className="text-sm truncate">{entry.name}</span>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Footer with selected path and select button */}
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-border bg-muted/30">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground truncate">
            {selectedPath || currentPath}
          </p>
        </div>
        <Button size="sm" onClick={handleSelect}>
          {t('remoteFileBrowser.select')}
        </Button>
      </div>
    </div>
  );
}
