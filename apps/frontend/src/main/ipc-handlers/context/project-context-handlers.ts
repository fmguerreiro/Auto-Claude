import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { IPC_CHANNELS, getSpecsDir, AUTO_BUILD_PATHS } from '../../../shared/constants';
import type {
  IPCResult,
  ProjectContextData,
  ProjectIndex,
  MemoryEpisode,
  Project
} from '../../../shared/types';
import { projectStore } from '../../project-store';
import { getMemoryService, isKuzuAvailable } from '../../memory-service';
import {
  getGraphitiDatabaseDetails
} from './utils';
import { getEffectiveSourcePath } from '../../updater/path-resolver';
import {
  loadGraphitiStateFromSpecs,
  buildMemoryStatus
} from './memory-status-handlers';
import { loadFileBasedMemories } from './memory-data-handlers';
import { pythonExecutor } from '../../python-executor';
import { sshManager } from '../../ssh/ssh-manager';
import { sshStore } from '../../ssh/ssh-store';

/**
 * Load project index from file (local)
 */
function loadProjectIndexLocal(projectPath: string): ProjectIndex | null {
  const indexPath = path.join(projectPath, AUTO_BUILD_PATHS.PROJECT_INDEX);
  if (!existsSync(indexPath)) {
    return null;
  }

  try {
    const content = readFileSync(indexPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Load project index from remote server via SSH
 */
async function loadProjectIndexRemote(project: Project): Promise<ProjectIndex | null> {
  if (!project.remote) {
    return null;
  }

  const server = sshStore.getServer(project.remote.serverId);
  if (!server) {
    return null;
  }

  const indexPath = path.posix.join(project.path, AUTO_BUILD_PATHS.PROJECT_INDEX);

  const result = await sshManager.executeCommand(
    server,
    `cat "${indexPath}" 2>/dev/null`
  );

  if (!result.success || !result.stdout.trim()) {
    return null;
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

/**
 * Load project index (handles both local and remote)
 */
async function loadProjectIndex(project: Project): Promise<ProjectIndex | null> {
  if (project.remote) {
    return loadProjectIndexRemote(project);
  }
  return loadProjectIndexLocal(project.path);
}

/**
 * Load recent memories from LadybugDB with file-based fallback
 */
async function loadRecentMemories(
  projectPath: string,
  autoBuildPath: string | undefined,
  memoryStatusAvailable: boolean,
  dbPath?: string,
  database?: string
): Promise<MemoryEpisode[]> {
  let recentMemories: MemoryEpisode[] = [];

  // Try to load from LadybugDB first if Graphiti is available and Kuzu is installed
  if (memoryStatusAvailable && isKuzuAvailable() && dbPath && database) {
    try {
      const memoryService = getMemoryService({
        dbPath,
        database,
      });
      const graphMemories = await memoryService.getEpisodicMemories(20);
      if (graphMemories.length > 0) {
        recentMemories = graphMemories;
      }
    } catch (error) {
      console.warn('Failed to load memories from LadybugDB, falling back to file-based:', error);
    }
  }

  // Fall back to file-based memory if no graph memories found
  if (recentMemories.length === 0) {
    const specsBaseDir = getSpecsDir(autoBuildPath);
    const specsDir = path.join(projectPath, specsBaseDir);
    recentMemories = loadFileBasedMemories(specsDir, 20);
  }

  return recentMemories;
}

/**
 * Register project context handlers
 */
export function registerProjectContextHandlers(
  _getMainWindow: () => BrowserWindow | null
): void {
  // Get full project context
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_GET,
    async (_, projectId: string): Promise<IPCResult<ProjectContextData>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        // Load project index (local or remote)
        const projectIndex = await loadProjectIndex(project);

        // Load graphiti state from most recent spec
        const memoryState = loadGraphitiStateFromSpecs(project.path, project.autoBuildPath);

        // Build memory status
        const memoryStatus = buildMemoryStatus(
          project.path,
          project.autoBuildPath,
          memoryState
        );

        // Load recent memories
        const recentMemories = await loadRecentMemories(
          project.path,
          project.autoBuildPath,
          memoryStatus.available,
          memoryStatus.dbPath,
          memoryStatus.database
        );

        return {
          success: true,
          data: {
            projectIndex,
            memoryStatus,
            memoryState,
            recentMemories,
            isLoading: false
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to load project context'
        };
      }
    }
  );

  // Refresh project index
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_REFRESH_INDEX,
    async (_, projectId: string): Promise<IPCResult<ProjectIndex>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        let autoBuildSource: string | null;
        let analyzerPath: string;
        let indexOutputPath: string;

        if (project.remote) {
          // For remote projects, get autoBuildPath from SSH server config
          const server = sshStore.getServer(project.remote.serverId);
          if (!server?.autoBuildPath) {
            return {
              success: false,
              error: 'Remote server does not have Auto-Claude path configured. Please set it in SSH server settings.'
            };
          }
          autoBuildSource = server.autoBuildPath;
          // Use posix paths for remote (Linux) servers
          analyzerPath = path.posix.join(autoBuildSource, 'apps', 'backend', 'analyzer.py');
          indexOutputPath = path.posix.join(project.path, AUTO_BUILD_PATHS.PROJECT_INDEX);
        } else {
          // For local projects, use local source path
          autoBuildSource = getEffectiveSourcePath();
          if (!autoBuildSource) {
            return {
              success: false,
              error: 'Auto-build source path not configured'
            };
          }
          analyzerPath = path.join(autoBuildSource, 'analyzer.py');
          indexOutputPath = path.join(project.path, AUTO_BUILD_PATHS.PROJECT_INDEX);
        }

        console.log('[project-context] Running analyzer via pythonExecutor, remote:', !!project.remote, 'source:', autoBuildSource);

        // Use centralized Python executor (handles local vs remote automatically)
        const result = await pythonExecutor.execute(
          project,
          analyzerPath,
          ['--project-dir', project.path, '--output', indexOutputPath]
        );

        if (result.success) {
          console.log('[project-context] Analyzer stdout:', result.stdout);
        } else {
          console.error('[project-context] Analyzer failed with code', result.code);
          console.error('[project-context] Analyzer stderr:', result.stderr);
          console.error('[project-context] Analyzer stdout:', result.stdout);
          throw new Error(`Analyzer exited with code ${result.code}: ${result.stderr || result.stdout}`);
        }

        // Read the new index
        const projectIndex = await loadProjectIndex(project);
        if (projectIndex) {
          return { success: true, data: projectIndex };
        }

        return { success: false, error: 'Failed to generate project index' };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to refresh project index'
        };
      }
    }
  );
}
