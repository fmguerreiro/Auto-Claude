/**
 * SFTP Browser - Browse remote directories via SSH
 *
 * Uses the system `sftp` command to leverage macOS Keychain and SSH config,
 * since the ssh2 library can't access Keychain-stored credentials.
 */

import { spawn } from 'child_process';
import type { SSHServer, RemoteDirectoryEntry } from '../../shared/types/ssh';
import { sshStore } from './ssh-store';

/**
 * Options for listing a remote directory
 */
export interface ListDirectoryOptions {
  /** Show hidden files (default: false) */
  showHidden?: boolean;
  /** Only show directories (default: false) */
  directoriesOnly?: boolean;
}

/**
 * SFTP Browser for navigating remote file systems
 * Uses the system sftp command for macOS Keychain compatibility
 */
export class SFTPBrowser {
  private connectionTimeout = 15000; // 15 seconds

  /**
   * Build SFTP connection string from server config
   * Uses host directly since SSH config aliases are resolved by the system ssh/sftp
   */
  private buildSFTPTarget(server: SSHServer): string {
    if (server.user) {
      return `${server.user}@${server.host}`;
    }
    return server.host;
  }

  /**
   * Build SFTP command arguments
   */
  private buildSFTPArgs(server: SSHServer): string[] {
    const args: string[] = [
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ConnectTimeout=10'
    ];

    // Add port if non-default
    if (server.port && server.port !== 22) {
      args.push('-P', String(server.port));
    }

    // Add identity file if specified
    if (server.identityFile) {
      args.push('-i', server.identityFile);
    }

    return args;
  }

  /**
   * Execute an SFTP command and return the output
   */
  private async executeSFTPCommand(server: SSHServer, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = this.buildSFTPArgs(server);
      const target = this.buildSFTPTarget(server);

      console.log('[SFTPBrowser] Executing:', 'sftp', args.join(' '), target);

      const sftpProcess = spawn('sftp', [...args, target], {
        env: { ...process.env }
      });

      let stdout = '';
      let stderr = '';

      sftpProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      sftpProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // Send the command to sftp's stdin
      sftpProcess.stdin?.write(command + '\n');
      sftpProcess.stdin?.write('bye\n');
      sftpProcess.stdin?.end();

      const timeoutId = setTimeout(() => {
        sftpProcess.kill();
        reject(new Error('SFTP operation timed out'));
      }, this.connectionTimeout);

      sftpProcess.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(new Error(`Failed to spawn SFTP process: ${err.message}`));
      });

      sftpProcess.on('close', (code) => {
        clearTimeout(timeoutId);

        if (code === 0 || stdout.length > 0) {
          resolve(stdout);
        } else {
          // Parse common errors
          let errorMsg = stderr.trim() || `SFTP exited with code ${code}`;
          if (stderr.includes('Permission denied')) {
            errorMsg = 'Permission denied - check SSH credentials';
          } else if (stderr.includes('Connection refused')) {
            errorMsg = 'Connection refused - is SSH server running?';
          } else if (stderr.includes('No route to host') || stderr.includes('Connection timed out')) {
            errorMsg = 'Cannot reach host - check network connection';
          } else if (stderr.includes('Could not resolve hostname')) {
            errorMsg = `Could not resolve hostname: ${server.host}`;
          }
          reject(new Error(`SSH connection failed: ${errorMsg}`));
        }
      });
    });
  }

  /**
   * Parse ls -la output into directory entries
   */
  private parseLsOutput(output: string, basePath: string, options: ListDirectoryOptions): RemoteDirectoryEntry[] {
    const { showHidden = false, directoriesOnly = false } = options;
    const entries: RemoteDirectoryEntry[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      // Skip empty lines and header lines
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('total') || trimmed.startsWith('sftp>')) {
        continue;
      }

      // Parse ls -la format: drwxr-xr-x  2 user group  4096 Jan  1 12:00 filename
      // The format varies, so we'll be flexible
      const parts = trimmed.split(/\s+/);
      if (parts.length < 9) continue;

      const permissions = parts[0];
      const filename = parts.slice(8).join(' '); // Filename might have spaces

      // Skip . and ..
      if (filename === '.' || filename === '..') continue;

      // Skip hidden files unless requested
      if (!showHidden && filename.startsWith('.')) continue;

      const isDirectory = permissions.startsWith('d');

      // Skip non-directories if directoriesOnly
      if (directoriesOnly && !isDirectory) continue;

      // Parse size (might not be accurate for directories)
      const size = parseInt(parts[4], 10) || 0;

      entries.push({
        name: filename,
        path: `${basePath}/${filename}`.replace(/\/+/g, '/'),
        isDirectory,
        size: isDirectory ? undefined : size
      });
    }

    // Sort: directories first, then alphabetically
    return entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * List contents of a remote directory
   */
  async listDirectory(
    serverId: string,
    remotePath: string,
    options: ListDirectoryOptions = {}
  ): Promise<RemoteDirectoryEntry[]> {
    const server = sshStore.getServer(serverId);
    if (!server) {
      throw new Error(`SSH server not found: ${serverId}`);
    }

    return this.listDirectoryOnServer(server, remotePath, options);
  }

  /**
   * List contents of a remote directory (using server config directly)
   */
  async listDirectoryOnServer(
    server: SSHServer,
    remotePath: string,
    options: ListDirectoryOptions = {}
  ): Promise<RemoteDirectoryEntry[]> {
    // Use ls -la to get detailed listing
    const command = `ls -la "${remotePath}"`;
    const output = await this.executeSFTPCommand(server, command);
    return this.parseLsOutput(output, remotePath, options);
  }

  /**
   * Get the home directory path on the remote server
   */
  async getHomeDirectory(serverId: string): Promise<string> {
    const server = sshStore.getServer(serverId);
    if (!server) {
      throw new Error(`SSH server not found: ${serverId}`);
    }

    // Use pwd to get current directory (which is home on connect)
    const output = await this.executeSFTPCommand(server, 'pwd');

    // Parse pwd output - look for a line that looks like a path
    const lines = output.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip sftp prompts and empty lines
      if (trimmed.startsWith('/') && !trimmed.includes('sftp>')) {
        // Extract just the path (might have "Remote working directory:" prefix)
        const match = trimmed.match(/\/[^\s]*/);
        if (match) {
          return match[0];
        }
      }
    }

    // Fallback to a reasonable default
    const user = server.user || process.env.USER || 'root';
    return `/home/${user}`;
  }
}

// Singleton instance
export const sftpBrowser = new SFTPBrowser();
