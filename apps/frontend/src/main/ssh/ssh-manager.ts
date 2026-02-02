/**
 * SSH Manager - Handles SSH connections and command execution
 */

import { spawn, type ChildProcess } from 'child_process';
import type { SSHServer, SSHConnectionTestResult } from '../../shared/types/ssh';
import { sshStore } from './ssh-store';

/**
 * Options for spawning a remote process
 */
export interface RemoteSpawnOptions {
  /** Environment variables to export on the remote (API keys etc handled server-side) */
  env?: Record<string, string>;
  /** Timeout for the SSH connection in milliseconds */
  timeout?: number;
}

/**
 * Manages SSH connections and remote process execution
 */
export class SSHManager {
  /**
   * Build SSH command arguments for a server
   */
  buildSSHArgs(server: SSHServer): string[] {
    const args: string[] = [];

    // Add user@host or just host
    if (server.user) {
      args.push(`${server.user}@${server.host}`);
    } else {
      args.push(server.host);
    }

    // Add port if non-default
    if (server.port && server.port !== 22) {
      args.unshift('-p', String(server.port));
    }

    // Add identity file if specified
    if (server.identityFile) {
      args.unshift('-i', server.identityFile);
    }

    return args;
  }

  /**
   * Build the remote command to execute
   */
  buildRemoteCommand(
    remotePath: string,
    pythonPath: string,
    args: string[]
  ): string {
    // Escape single quotes in arguments
    const escapedArgs = args.map((arg) => arg.replace(/'/g, "'\\''")).join(' ');

    // Use bash -l to source login profile (gets env vars like API keys)
    // Use single quotes to prevent local shell expansion
    return `bash -l -c 'cd ${remotePath} && ${pythonPath} ${escapedArgs}'`;
  }

  /**
   * Test SSH connection to a server
   */
  async testConnection(serverId: string): Promise<SSHConnectionTestResult> {
    const server = sshStore.getServer(serverId);
    if (!server) {
      return {
        success: false,
        message: 'Server not found',
        error: `No SSH server with ID "${serverId}"`
      };
    }

    return this.testServerConnection(server);
  }

  /**
   * Test SSH connection to a server config (without requiring it to be saved)
   * Also validates Python and Auto-Claude installation if autoBuildPath is configured
   */
  async testServerConnection(server: SSHServer): Promise<SSHConnectionTestResult> {
    const startTime = Date.now();

    // Step 1: Basic SSH connectivity test
    const connectResult = await this.testBasicConnection(server);
    if (!connectResult.success) {
      return connectResult;
    }

    const latencyMs = Date.now() - startTime;

    // Step 2: Test Python availability
    const pythonPath = server.pythonPath || 'python3';
    const pythonResult = await this.executeCommand(
      server,
      `${pythonPath} --version 2>&1`
    );

    if (!pythonResult.success) {
      return {
        success: false,
        message: `Connected but Python not found`,
        error: `Python command '${pythonPath}' failed: ${pythonResult.stderr}`,
        latencyMs
      };
    }

    const pythonVersion = pythonResult.stdout.trim();

    // Step 3: If autoBuildPath is configured, verify Auto-Claude installation
    const autoBuildPath = server.autoBuildPath || '~/opt/Auto-Claude';
    const analyzerPath = `${autoBuildPath}/apps/backend/analyzer.py`;

    const analyzerResult = await this.executeCommand(
      server,
      `test -f "${analyzerPath}" && echo "FOUND" || echo "NOT_FOUND"`
    );

    if (!analyzerResult.stdout.includes('FOUND')) {
      return {
        success: false,
        message: `Connected but Auto-Claude not found`,
        error: `Auto-Claude not installed at ${autoBuildPath}. Clone the repo there or update the path in settings.`,
        latencyMs
      };
    }

    return {
      success: true,
      message: `Connected to ${server.name}`,
      serverVersion: pythonVersion,
      latencyMs
    };
  }

  /**
   * Basic SSH connectivity test (just echo)
   */
  private testBasicConnection(server: SSHServer): Promise<SSHConnectionTestResult> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const sshArgs = this.buildSSHArgs(server);

      // Add options for connection testing
      sshArgs.unshift(
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=10',
        '-o', 'StrictHostKeyChecking=accept-new'
      );

      // Simple echo test
      sshArgs.push('echo', 'SSH_CONNECTION_OK');

      const sshProcess = spawn('ssh', sshArgs, {
        env: { ...process.env }
      });

      let stdout = '';
      let stderr = '';

      sshProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      sshProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      sshProcess.on('error', (err) => {
        resolve({
          success: false,
          message: 'Failed to spawn SSH process',
          error: err.message
        });
      });

      sshProcess.on('close', (code) => {
        const latencyMs = Date.now() - startTime;

        if (code === 0 && stdout.includes('SSH_CONNECTION_OK')) {
          resolve({
            success: true,
            message: `Connected to ${server.name}`,
            latencyMs
          });
        } else {
          // Parse common SSH errors
          let errorMessage = stderr.trim() || `SSH exited with code ${code}`;

          if (stderr.includes('Permission denied')) {
            errorMessage = 'Permission denied - check SSH key or credentials';
          } else if (stderr.includes('Connection refused')) {
            errorMessage = 'Connection refused - is SSH server running?';
          } else if (stderr.includes('No route to host') || stderr.includes('Connection timed out')) {
            errorMessage = 'Cannot reach host - check network connection';
          } else if (stderr.includes('Host key verification failed')) {
            errorMessage = 'Host key verification failed - check known_hosts';
          }

          resolve({
            success: false,
            message: `Failed to connect to ${server.name}`,
            error: errorMessage,
            latencyMs
          });
        }
      });

      // Safety timeout
      setTimeout(() => {
        sshProcess.kill();
        resolve({
          success: false,
          message: 'Connection timed out',
          error: 'SSH connection took longer than 15 seconds',
          latencyMs: 15000
        });
      }, 15000);
    });
  }

  /**
   * Spawn a process on a remote server via SSH
   * Returns the ChildProcess for stdout/stderr handling
   */
  spawnRemoteProcess(
    serverId: string,
    remotePath: string,
    args: string[],
    options: RemoteSpawnOptions = {}
  ): ChildProcess {
    const server = sshStore.getServer(serverId);
    if (!server) {
      throw new Error(`SSH server not found: ${serverId}`);
    }

    const pythonPath = server.pythonPath || 'python3';
    const remoteCommand = this.buildRemoteCommand(remotePath, pythonPath, args);
    const sshArgs = this.buildSSHArgs(server);

    // Add TTY allocation for proper signal handling
    sshArgs.unshift('-t');

    // Add the remote command
    sshArgs.push(remoteCommand);

    // Build environment - only pass SSH_AUTH_SOCK for ssh-agent
    const env: NodeJS.ProcessEnv = {
      SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK
    };

    // Add any additional env vars from options
    if (options.env) {
      Object.assign(env, options.env);
    }

    console.log('[SSHManager] Spawning remote process:', {
      server: server.name,
      host: server.host,
      remotePath,
      command: `ssh ${sshArgs.join(' ')}`
    });

    return spawn('ssh', sshArgs, { env });
  }

  /**
   * Get Python path for a server (with fallback to default)
   */
  getPythonPath(serverId: string): string {
    const server = sshStore.getServer(serverId);
    return server?.pythonPath || 'python3';
  }

  /**
   * Execute a shell command on a remote server and return the result
   * Used for initialization, git checks, etc.
   */
  async executeCommand(
    server: SSHServer,
    command: string,
    options: { timeout?: number } = {}
  ): Promise<{ success: boolean; stdout: string; stderr: string; code: number | null }> {
    const timeout = options.timeout ?? 30000;

    return new Promise((resolve) => {
      const sshArgs = this.buildSSHArgs(server);

      // Add options for non-interactive execution
      sshArgs.unshift(
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=10',
        '-o', 'StrictHostKeyChecking=accept-new'
      );

      // Wrap command in bash -l to get login environment
      sshArgs.push(`bash -l -c '${command.replace(/'/g, "'\\''")}'`);

      console.log('[SSHManager] Executing remote command:', { host: server.host, command });

      const sshProcess = spawn('ssh', sshArgs, {
        env: { ...process.env }
      });

      let stdout = '';
      let stderr = '';

      sshProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      sshProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timeoutId = setTimeout(() => {
        sshProcess.kill();
        resolve({
          success: false,
          stdout,
          stderr: 'Command timed out',
          code: null
        });
      }, timeout);

      sshProcess.on('error', (err) => {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          stdout,
          stderr: err.message,
          code: null
        });
      });

      sshProcess.on('close', (code) => {
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
   * Execute a command using server ID (convenience wrapper)
   */
  async executeCommandById(
    serverId: string,
    command: string,
    options: { timeout?: number } = {}
  ): Promise<{ success: boolean; stdout: string; stderr: string; code: number | null }> {
    const server = sshStore.getServer(serverId);
    if (!server) {
      return {
        success: false,
        stdout: '',
        stderr: `SSH server not found: ${serverId}`,
        code: null
      };
    }
    return this.executeCommand(server, command, options);
  }
}

// Singleton instance
export const sshManager = new SSHManager();
