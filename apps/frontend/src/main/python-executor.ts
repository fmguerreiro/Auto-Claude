/**
 * PythonExecutor - Centralized Python execution for local and remote projects
 *
 * All Python script execution should go through this service. It automatically
 * routes execution to either local spawn or SSH based on project configuration.
 */

import { spawn, type ChildProcess } from 'child_process';
import type { Project } from '../shared/types';
import { sshManager } from './ssh/ssh-manager';
import { sshStore } from './ssh/ssh-store';
import { parsePythonCommand } from './python-detector';
import { getConfiguredPythonPath } from './python-env-manager';
import { getAugmentedEnv } from './env-utils';

/**
 * Result of a Python script execution
 */
export interface PythonExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Options for Python execution
 */
export interface PythonExecutionOptions {
  /** Working directory (defaults to project path) */
  cwd?: string;
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Timeout in milliseconds (default: 60000) */
  timeout?: number;
  /** For remote: use the server's configured Python path */
  useServerPython?: boolean;
}

/**
 * Options for spawning a Python process (streaming output)
 */
export interface PythonSpawnOptions extends PythonExecutionOptions {
  /** Called when stdout data is received */
  onStdout?: (data: string) => void;
  /** Called when stderr data is received */
  onStderr?: (data: string) => void;
  /** Called when process exits */
  onExit?: (code: number | null) => void;
  /** Called on error */
  onError?: (error: Error) => void;
}

/**
 * Centralized Python executor that handles both local and remote projects
 */
class PythonExecutorService {
  /**
   * Execute a Python script and wait for completion
   * Returns the full stdout/stderr after the script finishes
   */
  async execute(
    project: Project,
    scriptPath: string,
    args: string[] = [],
    options: PythonExecutionOptions = {}
  ): Promise<PythonExecutionResult> {
    const timeout = options.timeout ?? 60000;
    const cwd = options.cwd ?? project.path;

    if (project.remote) {
      return this.executeRemote(project, scriptPath, args, cwd, timeout, options.env);
    }

    return this.executeLocal(scriptPath, args, cwd, timeout, options.env);
  }

  /**
   * Spawn a Python process with streaming output
   * Use this when you need real-time output (e.g., for agent processes)
   */
  spawn(
    project: Project,
    scriptPath: string,
    args: string[] = [],
    options: PythonSpawnOptions = {}
  ): ChildProcess {
    const cwd = options.cwd ?? project.path;

    if (project.remote) {
      return this.spawnRemote(project, scriptPath, args, cwd, options);
    }

    return this.spawnLocal(scriptPath, args, cwd, options);
  }

  /**
   * Execute Python script locally
   */
  private executeLocal(
    scriptPath: string,
    args: string[],
    cwd: string,
    timeout: number,
    extraEnv?: Record<string, string>
  ): Promise<PythonExecutionResult> {
    return new Promise((resolve) => {
      const pythonCmd = getConfiguredPythonPath();
      const [pythonCommand, pythonBaseArgs] = parsePythonCommand(pythonCmd);

      let stdout = '';
      let stderr = '';

      const env = {
        ...getAugmentedEnv(),
        ...extraEnv
      };

      const proc = spawn(pythonCommand, [...pythonBaseArgs, scriptPath, ...args], {
        cwd,
        env
      });

      const timeoutId = setTimeout(() => {
        proc.kill();
        resolve({
          success: false,
          stdout,
          stderr: 'Execution timed out',
          code: null
        });
      }, timeout);

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          stdout,
          stderr: err.message,
          code: null
        });
      });

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        resolve({
          success: code === 0,
          stdout,
          stderr,
          code
        });
      });
    });
  }

  /**
   * Execute Python script on remote server via SSH
   */
  private async executeRemote(
    project: Project,
    scriptPath: string,
    args: string[],
    cwd: string,
    timeout: number,
    extraEnv?: Record<string, string>
  ): Promise<PythonExecutionResult> {
    if (!project.remote) {
      return {
        success: false,
        stdout: '',
        stderr: 'Project is not configured as remote',
        code: null
      };
    }

    const server = sshStore.getServer(project.remote.serverId);
    if (!server) {
      return {
        success: false,
        stdout: '',
        stderr: `SSH server not found: ${project.remote.serverId}`,
        code: null
      };
    }

    // Build the command to run on remote
    const pythonPath = server.pythonPath || 'python3';
    const escapedArgs = args.map(arg => `"${arg.replace(/"/g, '\\"')}"`).join(' ');

    // Build environment exports if needed
    let envExports = '';
    if (extraEnv && Object.keys(extraEnv).length > 0) {
      envExports = Object.entries(extraEnv)
        .map(([key, value]) => `export ${key}="${value.replace(/"/g, '\\"')}"`)
        .join(' && ') + ' && ';
    }

    const command = `cd "${cwd}" && ${envExports}${pythonPath} "${scriptPath}" ${escapedArgs}`;

    return sshManager.executeCommand(server, command, { timeout });
  }

  /**
   * Spawn Python process locally with streaming
   */
  private spawnLocal(
    scriptPath: string,
    args: string[],
    cwd: string,
    options: PythonSpawnOptions
  ): ChildProcess {
    const pythonCmd = getConfiguredPythonPath();
    const [pythonCommand, pythonBaseArgs] = parsePythonCommand(pythonCmd);

    const env = {
      ...getAugmentedEnv(),
      ...options.env
    };

    const proc = spawn(pythonCommand, [...pythonBaseArgs, scriptPath, ...args], {
      cwd,
      env
    });

    if (options.onStdout) {
      proc.stdout?.on('data', (data: Buffer) => {
        options.onStdout!(data.toString());
      });
    }

    if (options.onStderr) {
      proc.stderr?.on('data', (data: Buffer) => {
        options.onStderr!(data.toString());
      });
    }

    if (options.onExit) {
      proc.on('close', (code) => {
        options.onExit!(code);
      });
    }

    if (options.onError) {
      proc.on('error', (err) => {
        options.onError!(err);
      });
    }

    return proc;
  }

  /**
   * Spawn Python process on remote server via SSH with streaming
   */
  private spawnRemote(
    project: Project,
    scriptPath: string,
    args: string[],
    cwd: string,
    options: PythonSpawnOptions
  ): ChildProcess {
    if (!project.remote) {
      throw new Error('Project is not configured as remote');
    }

    const server = sshStore.getServer(project.remote.serverId);
    if (!server) {
      throw new Error(`SSH server not found: ${project.remote.serverId}`);
    }

    // Use sshManager's spawnRemoteProcess for streaming
    // Note: This expects args to be Python script arguments, we need to adapt
    const pythonPath = server.pythonPath || 'python3';

    // Build SSH args
    const sshArgs = sshManager.buildSSHArgs(server);

    // Add TTY allocation for proper signal handling
    sshArgs.unshift('-t');

    // Build environment exports if needed
    let envExports = '';
    if (options.env && Object.keys(options.env).length > 0) {
      envExports = Object.entries(options.env)
        .map(([key, value]) => `export ${key}="${value.replace(/"/g, '\\"')}"`)
        .join(' && ') + ' && ';
    }

    // Escape args for remote shell
    const escapedArgs = args.map(arg => `"${arg.replace(/"/g, '\\"')}"`).join(' ');

    // Build remote command
    const remoteCommand = `bash -l -c 'cd "${cwd}" && ${envExports}${pythonPath} "${scriptPath}" ${escapedArgs}'`;
    sshArgs.push(remoteCommand);

    console.log('[PythonExecutor] Spawning remote process:', {
      server: server.name,
      scriptPath,
      args
    });

    const proc = spawn('ssh', sshArgs, {
      env: { ...process.env }
    });

    if (options.onStdout) {
      proc.stdout?.on('data', (data: Buffer) => {
        options.onStdout!(data.toString());
      });
    }

    if (options.onStderr) {
      proc.stderr?.on('data', (data: Buffer) => {
        options.onStderr!(data.toString());
      });
    }

    if (options.onExit) {
      proc.on('close', (code) => {
        options.onExit!(code);
      });
    }

    if (options.onError) {
      proc.on('error', (err) => {
        options.onError!(err);
      });
    }

    return proc;
  }

  /**
   * Check if a project is remote
   */
  isRemote(project: Project): boolean {
    return !!project.remote;
  }

  /**
   * Get the Python path for a project
   * For local: returns configured venv/system Python
   * For remote: returns the server's configured Python path
   */
  getPythonPath(project: Project): string {
    if (project.remote) {
      const server = sshStore.getServer(project.remote.serverId);
      return server?.pythonPath || 'python3';
    }
    return getConfiguredPythonPath();
  }
}

// Singleton instance
export const pythonExecutor = new PythonExecutorService();
