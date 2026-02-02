import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { getToolPath } from './cli-tool-manager';
import { sshManager } from './ssh/ssh-manager';
import { sshStore } from './ssh/ssh-store';
import type { RemoteProjectConfig } from '../shared/types/ssh';

/**
 * Debug logging - only logs when DEBUG=true or in development mode
 */
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debug(message: string, data?: Record<string, unknown>): void {
  if (DEBUG) {
    if (data) {
      console.warn(`[ProjectInitializer] ${message}`, JSON.stringify(data, null, 2));
    } else {
      console.warn(`[ProjectInitializer] ${message}`);
    }
  }
}

/**
 * Git status information for a project
 */
export interface GitStatus {
  isGitRepo: boolean;
  hasCommits: boolean;
  currentBranch: string | null;
  error?: string;
}

/**
 * Check if a directory is a git repository and has at least one commit
 */
export function checkGitStatus(projectPath: string): GitStatus {
  const git = getToolPath('git');

  try {
    // Check if it's a git repository
    execFileSync(git, ['rev-parse', '--git-dir'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch {
    return {
      isGitRepo: false,
      hasCommits: false,
      currentBranch: null,
      error: 'Not a git repository. Please run "git init" to initialize git.'
    };
  }

  // Check if there are any commits
  let hasCommits = false;
  try {
    execFileSync(git, ['rev-parse', 'HEAD'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    hasCommits = true;
  } catch {
    // No commits yet
    hasCommits = false;
  }

  // Get current branch
  let currentBranch: string | null = null;
  try {
    currentBranch = execFileSync(git, ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    // Branch detection failed
  }

  if (!hasCommits) {
    return {
      isGitRepo: true,
      hasCommits: false,
      currentBranch,
      error: 'Git repository has no commits. Please make an initial commit first.'
    };
  }

  return {
    isGitRepo: true,
    hasCommits: true,
    currentBranch
  };
}

/**
 * Initialize git in a project directory and create an initial commit.
 * This is a user-friendly way to set up git for non-technical users.
 */
export function initializeGit(projectPath: string): InitializationResult {
  debug('initializeGit called', { projectPath });

  // Check current git status
  const status = checkGitStatus(projectPath);
  const git = getToolPath('git');

  try {
    // Step 1: Initialize git if needed
    if (!status.isGitRepo) {
      debug('Initializing git repository');
      execFileSync(git, ['init'], {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    }

    // Step 2: Check if there are files to commit
    const statusOutput = execFileSync(git, ['status', '--porcelain'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    // Step 3: If there are untracked/modified files, add and commit them
    if (statusOutput || !status.hasCommits) {
      debug('Adding files and creating initial commit');

      // Add all files
      execFileSync(git, ['add', '-A'], {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Create initial commit
      execFileSync(git, ['commit', '-m', 'Initial commit', '--allow-empty'], {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    }

    debug('Git initialization complete');
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error during git initialization';
    debug('Git initialization failed', { error: errorMessage });
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Entries to add to .gitignore when initializing a project
 */
const GITIGNORE_ENTRIES = ['.auto-claude/'];

/**
 * Ensure entries exist in the project's .gitignore file.
 * Creates .gitignore if it doesn't exist.
 */
function ensureGitignoreEntries(projectPath: string, entries: string[]): void {
  const gitignorePath = path.join(projectPath, '.gitignore');

  let content = '';
  let existingLines: string[] = [];

  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, 'utf-8');
    existingLines = content.split('\n').map(line => line.trim());
  }

  // Find entries that need to be added
  const entriesToAdd: string[] = [];
  for (const entry of entries) {
    const entryNormalized = entry.replace(/\/$/, ''); // Remove trailing slash for comparison
    const alreadyExists = existingLines.some(line => {
      const lineNormalized = line.replace(/\/$/, '');
      return lineNormalized === entry || lineNormalized === entryNormalized;
    });

    if (!alreadyExists) {
      entriesToAdd.push(entry);
    }
  }

  if (entriesToAdd.length === 0) {
    debug('All gitignore entries already exist');
    return;
  }

  // Build the content to append
  let appendContent = '';

  // Ensure file ends with newline before adding our entries
  if (content && !content.endsWith('\n')) {
    appendContent += '\n';
  }

  appendContent += '\n# Auto Claude data directory\n';
  for (const entry of entriesToAdd) {
    appendContent += entry + '\n';
  }

  if (existsSync(gitignorePath)) {
    appendFileSync(gitignorePath, appendContent);
  } else {
    writeFileSync(gitignorePath, '# Auto Claude data directory\n' + entriesToAdd.join('\n') + '\n');
  }

  debug('Added entries to .gitignore', { entries: entriesToAdd });
}

/**
 * Data directories created in .auto-claude for each project
 */
const DATA_DIRECTORIES = [
  'specs',
  'ideation',
  'insights',
  'roadmap'
];

/**
 * Result of initialization operation
 */
export interface InitializationResult {
  success: boolean;
  error?: string;
}

/**
 * Check if the project has a local backend source directory
 * This indicates it's the development project itself
 */
export function hasLocalSource(projectPath: string): boolean {
  const localSourcePath = path.join(projectPath, 'apps', 'backend');
  // Use runners/spec_runner.py as marker - ensures valid backend
  const markerFile = path.join(localSourcePath, 'runners', 'spec_runner.py');
  return existsSync(localSourcePath) && existsSync(markerFile);
}

/**
 * Get the local source path for a project (if it exists)
 */
export function getLocalSourcePath(projectPath: string): string | null {
  const localSourcePath = path.join(projectPath, 'apps', 'backend');
  if (hasLocalSource(projectPath)) {
    return localSourcePath;
  }
  return null;
}

/**
 * Check if project is initialized (has .auto-claude directory)
 */
export function isInitialized(projectPath: string): boolean {
  const dotAutoBuildPath = path.join(projectPath, '.auto-claude');
  return existsSync(dotAutoBuildPath);
}

/**
 * Initialize auto-claude data directory in a project.
 *
 * Creates .auto-claude/ with data directories (specs, ideation, insights, roadmap).
 * The framework code runs from the source repo - only data is stored here.
 *
 * Requires:
 * - Project directory must exist
 * - Project must be a git repository with at least one commit
 */
export function initializeProject(projectPath: string): InitializationResult {
  debug('initializeProject called', { projectPath });

  // Validate project path exists
  if (!existsSync(projectPath)) {
    debug('Project path does not exist', { projectPath });
    return {
      success: false,
      error: `Project directory not found: ${projectPath}`
    };
  }

  // Check git status - Auto Claude requires git for worktree-based builds
  const gitStatus = checkGitStatus(projectPath);
  if (!gitStatus.isGitRepo || !gitStatus.hasCommits) {
    debug('Git check failed', { gitStatus });
    return {
      success: false,
      error: gitStatus.error || 'Git repository required. Auto Claude uses git worktrees for isolated builds.'
    };
  }

  // Check if already initialized
  const dotAutoBuildPath = path.join(projectPath, '.auto-claude');

  if (existsSync(dotAutoBuildPath)) {
    debug('Already initialized - .auto-claude exists');
    return {
      success: false,
      error: 'Project already has auto-claude initialized (.auto-claude exists)'
    };
  }

  try {
    debug('Creating .auto-claude data directory', { dotAutoBuildPath });

    // Create the .auto-claude directory
    mkdirSync(dotAutoBuildPath, { recursive: true });

    // Create data directories
    for (const dataDir of DATA_DIRECTORIES) {
      const dirPath = path.join(dotAutoBuildPath, dataDir);
      debug('Creating data directory', { dataDir, dirPath });
      mkdirSync(dirPath, { recursive: true });
      writeFileSync(path.join(dirPath, '.gitkeep'), '');
    }

    // Update .gitignore to exclude .auto-claude/
    ensureGitignoreEntries(projectPath, GITIGNORE_ENTRIES);

    debug('Initialization complete');
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error during initialization';
    debug('Initialization failed', { error: errorMessage });
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Ensure all data directories exist in .auto-claude.
 * Useful if new directories are added in future versions.
 */
export function ensureDataDirectories(projectPath: string): InitializationResult {
  const dotAutoBuildPath = path.join(projectPath, '.auto-claude');

  if (!existsSync(dotAutoBuildPath)) {
    return {
      success: false,
      error: 'Project not initialized. Run initialize first.'
    };
  }

  try {
    for (const dataDir of DATA_DIRECTORIES) {
      const dirPath = path.join(dotAutoBuildPath, dataDir);
      if (!existsSync(dirPath)) {
        debug('Creating missing data directory', { dataDir, dirPath });
        mkdirSync(dirPath, { recursive: true });
        writeFileSync(path.join(dirPath, '.gitkeep'), '');
      }
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get the auto-claude folder path for a project.
 *
 * IMPORTANT: Only .auto-claude/ is considered a valid "installed" auto-claude.
 * The auto-claude/ folder (if it exists) is the SOURCE CODE being developed,
 * not an installation. This allows Auto Claude to be used to develop itself.
 */
export function getAutoBuildPath(projectPath: string): string | null {
  const dotAutoBuildPath = path.join(projectPath, '.auto-claude');

  debug('getAutoBuildPath called', { projectPath, dotAutoBuildPath });

  if (existsSync(dotAutoBuildPath)) {
    debug('Returning .auto-claude (installed version)');
    return '.auto-claude';
  }

  debug('No .auto-claude folder found - project not initialized');
  return null;
}

/**
 * Initialize auto-claude data directory on a REMOTE server via SSH.
 *
 * This is the remote equivalent of initializeProject() - it creates the
 * .auto-claude directory with data directories on the remote server.
 */
export async function initializeRemoteProject(
  remotePath: string,
  remote: RemoteProjectConfig
): Promise<InitializationResult> {
  debug('initializeRemoteProject called', { remotePath, serverId: remote.serverId });

  const server = sshStore.getServer(remote.serverId);
  if (!server) {
    return {
      success: false,
      error: `SSH server not found: ${remote.serverId}`
    };
  }

  // Check if remote path exists
  const checkPathResult = await sshManager.executeCommand(
    server,
    `test -d "${remotePath}" && echo "EXISTS" || echo "NOT_FOUND"`
  );

  if (!checkPathResult.stdout.includes('EXISTS')) {
    debug('Remote path does not exist', { remotePath });
    return {
      success: false,
      error: `Remote directory not found: ${remotePath}`
    };
  }

  // Check git status on remote
  const gitCheckResult = await sshManager.executeCommand(
    server,
    `cd "${remotePath}" && git rev-parse --git-dir 2>/dev/null && git rev-parse HEAD 2>/dev/null && echo "GIT_OK"`
  );

  if (!gitCheckResult.stdout.includes('GIT_OK')) {
    debug('Git check failed on remote', { stdout: gitCheckResult.stdout, stderr: gitCheckResult.stderr });
    return {
      success: false,
      error: 'Remote project must be a git repository with at least one commit'
    };
  }

  // Check if already initialized
  const checkInitResult = await sshManager.executeCommand(
    server,
    `test -d "${remotePath}/.auto-claude" && echo "INITIALIZED" || echo "NOT_INITIALIZED"`
  );

  if (checkInitResult.stdout.includes('INITIALIZED')) {
    debug('Remote project already initialized');
    return {
      success: false,
      error: 'Remote project already has auto-claude initialized (.auto-claude exists)'
    };
  }

  // Create .auto-claude directory structure
  const dataDirs = DATA_DIRECTORIES.map(dir => `"${remotePath}/.auto-claude/${dir}"`).join(' ');
  const createResult = await sshManager.executeCommand(
    server,
    `mkdir -p ${dataDirs} && touch ${DATA_DIRECTORIES.map(dir => `"${remotePath}/.auto-claude/${dir}/.gitkeep"`).join(' ')}`
  );

  if (!createResult.success) {
    debug('Failed to create directories on remote', { stderr: createResult.stderr });
    return {
      success: false,
      error: `Failed to create .auto-claude directory: ${createResult.stderr}`
    };
  }

  // Update .gitignore
  const gitignoreEntry = '.auto-claude/';
  const updateGitignoreResult = await sshManager.executeCommand(
    server,
    `cd "${remotePath}" && (grep -qxF "${gitignoreEntry}" .gitignore 2>/dev/null || echo -e "\\n# Auto Claude data directory\\n${gitignoreEntry}" >> .gitignore)`
  );

  if (!updateGitignoreResult.success) {
    // Non-fatal - just log it
    debug('Failed to update .gitignore on remote (non-fatal)', { stderr: updateGitignoreResult.stderr });
  }

  debug('Remote initialization complete');
  return { success: true };
}

/**
 * Check if a remote project is initialized
 */
export async function isRemoteInitialized(
  remotePath: string,
  remote: RemoteProjectConfig
): Promise<boolean> {
  const server = sshStore.getServer(remote.serverId);
  if (!server) {
    return false;
  }

  const result = await sshManager.executeCommand(
    server,
    `test -d "${remotePath}/.auto-claude" && echo "YES" || echo "NO"`
  );

  return result.stdout.includes('YES');
}

/**
 * Check git status on a remote project
 */
export async function checkRemoteGitStatus(
  remotePath: string,
  remote: RemoteProjectConfig
): Promise<GitStatus> {
  const server = sshStore.getServer(remote.serverId);
  if (!server) {
    return {
      isGitRepo: false,
      hasCommits: false,
      currentBranch: null,
      error: `SSH server not found: ${remote.serverId}`
    };
  }

  // Check if it's a git repo
  const gitDirResult = await sshManager.executeCommand(
    server,
    `cd "${remotePath}" && git rev-parse --git-dir 2>/dev/null && echo "IS_GIT_REPO"`
  );

  if (!gitDirResult.stdout.includes('IS_GIT_REPO')) {
    return {
      isGitRepo: false,
      hasCommits: false,
      currentBranch: null,
      error: 'Not a git repository. Please run "git init" to initialize git.'
    };
  }

  // Check for commits
  const headResult = await sshManager.executeCommand(
    server,
    `cd "${remotePath}" && git rev-parse HEAD 2>/dev/null && echo "HAS_COMMITS"`
  );

  const hasCommits = headResult.stdout.includes('HAS_COMMITS');

  // Get current branch
  const branchResult = await sshManager.executeCommand(
    server,
    `cd "${remotePath}" && git rev-parse --abbrev-ref HEAD 2>/dev/null`
  );

  const currentBranch = branchResult.success ? branchResult.stdout.trim() : null;

  if (!hasCommits) {
    return {
      isGitRepo: true,
      hasCommits: false,
      currentBranch,
      error: 'Git repository has no commits. Please make an initial commit first.'
    };
  }

  return {
    isGitRepo: true,
    hasCommits: true,
    currentBranch
  };
}
