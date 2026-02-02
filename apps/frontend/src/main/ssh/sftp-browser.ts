/**
 * SFTP Browser - Browse remote directories via SSH
 */

import { Client, type ConnectConfig } from 'ssh2';
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
 */
export class SFTPBrowser {
  private connectionTimeout = 10000; // 10 seconds

  /**
   * Build SSH2 connection config from an SSHServer
   */
  private buildConnectConfig(server: SSHServer): ConnectConfig {
    const config: ConnectConfig = {
      host: server.host,
      port: server.port || 22,
      username: server.user || process.env.USER || 'root',
      agent: process.env.SSH_AUTH_SOCK,
      readyTimeout: this.connectionTimeout
    };

    if (server.identityFile) {
      // Note: ssh2 can read the key file directly
      config.privateKey = require('fs').readFileSync(server.identityFile);
    }

    return config;
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
    const { showHidden = false, directoriesOnly = false } = options;

    return new Promise((resolve, reject) => {
      const conn = new Client();
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          conn.end();
        }
      };

      // Safety timeout
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('SFTP operation timed out'));
      }, this.connectionTimeout + 5000);

      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) {
            clearTimeout(timeoutId);
            cleanup();
            reject(new Error(`Failed to start SFTP: ${err.message}`));
            return;
          }

          // Expand ~ to home directory
          const expandedPath = remotePath.startsWith('~')
            ? remotePath // Let SFTP handle ~ expansion
            : remotePath;

          sftp.readdir(expandedPath, (err, list) => {
            clearTimeout(timeoutId);
            cleanup();

            if (err) {
              reject(new Error(`Failed to read directory: ${err.message}`));
              return;
            }

            const entries: RemoteDirectoryEntry[] = list
              .filter((item) => {
                // Filter hidden files
                if (!showHidden && item.filename.startsWith('.')) {
                  return false;
                }
                // Filter to directories only
                if (directoriesOnly && !item.attrs.isDirectory()) {
                  return false;
                }
                return true;
              })
              .map((item) => ({
                name: item.filename,
                path: `${remotePath}/${item.filename}`.replace(/\/+/g, '/'),
                isDirectory: item.attrs.isDirectory(),
                size: item.attrs.size,
                modifiedAt: item.attrs.mtime ? new Date(item.attrs.mtime * 1000) : undefined
              }))
              .sort((a, b) => {
                // Directories first, then alphabetical
                if (a.isDirectory !== b.isDirectory) {
                  return a.isDirectory ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
              });

            resolved = true;
            resolve(entries);
          });
        });
      });

      conn.on('error', (err) => {
        clearTimeout(timeoutId);
        cleanup();
        reject(new Error(`SSH connection failed: ${err.message}`));
      });

      try {
        conn.connect(this.buildConnectConfig(server));
      } catch (err) {
        clearTimeout(timeoutId);
        reject(new Error(`Failed to initiate connection: ${err instanceof Error ? err.message : String(err)}`));
      }
    });
  }

  /**
   * Check if a remote path exists and is a directory
   */
  async isDirectory(serverId: string, remotePath: string): Promise<boolean> {
    const server = sshStore.getServer(serverId);
    if (!server) {
      throw new Error(`SSH server not found: ${serverId}`);
    }

    return new Promise((resolve, reject) => {
      const conn = new Client();
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          conn.end();
        }
      };

      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('SFTP operation timed out'));
      }, this.connectionTimeout + 5000);

      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) {
            clearTimeout(timeoutId);
            cleanup();
            reject(err);
            return;
          }

          sftp.stat(remotePath, (err, stats) => {
            clearTimeout(timeoutId);
            cleanup();

            if (err) {
              resolve(false); // Path doesn't exist
              return;
            }

            resolved = true;
            resolve(stats.isDirectory());
          });
        });
      });

      conn.on('error', (err) => {
        clearTimeout(timeoutId);
        cleanup();
        reject(err);
      });

      conn.connect(this.buildConnectConfig(server));
    });
  }

  /**
   * Get the home directory path on the remote server
   */
  async getHomeDirectory(serverId: string): Promise<string> {
    const server = sshStore.getServer(serverId);
    if (!server) {
      throw new Error(`SSH server not found: ${serverId}`);
    }

    return new Promise((resolve, reject) => {
      const conn = new Client();
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          conn.end();
        }
      };

      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('SFTP operation timed out'));
      }, this.connectionTimeout + 5000);

      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) {
            clearTimeout(timeoutId);
            cleanup();
            reject(err);
            return;
          }

          // Use realpath on ~ to get home directory
          sftp.realpath('.', (err, absPath) => {
            clearTimeout(timeoutId);
            cleanup();

            if (err) {
              // Fallback to a reasonable default
              const user = server.user || process.env.USER || 'root';
              resolved = true;
              resolve(`/home/${user}`);
              return;
            }

            resolved = true;
            resolve(absPath);
          });
        });
      });

      conn.on('error', (err) => {
        clearTimeout(timeoutId);
        cleanup();
        reject(err);
      });

      conn.connect(this.buildConnectConfig(server));
    });
  }
}

// Singleton instance
export const sftpBrowser = new SFTPBrowser();
