/**
 * SSH IPC Handlers - Remote project support via SSH
 *
 * Provides IPC handlers for:
 * - SSH server management (CRUD operations)
 * - Connection testing
 * - Remote directory browsing via SFTP
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';
import type {
  SSHServer,
  SSHConnectionTestResult,
  RemoteDirectoryEntry
} from '../../shared/types/ssh';
import { sshStore, sshManager, sftpBrowser, type ListDirectoryOptions } from '../ssh';

/**
 * Register all SSH-related IPC handlers
 */
export function registerSshHandlers(): void {
  // ============================================
  // SSH Server Management
  // ============================================

  ipcMain.handle(
    IPC_CHANNELS.SSH_SERVER_LIST,
    async (): Promise<IPCResult<SSHServer[]>> => {
      try {
        const servers = sshStore.getServers();
        return { success: true, data: servers };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list SSH servers'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SSH_SERVER_GET,
    async (_, serverId: string): Promise<IPCResult<SSHServer | undefined>> => {
      try {
        const server = sshStore.getServer(serverId);
        return { success: true, data: server };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get SSH server'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SSH_SERVER_ADD,
    async (_, serverData: Omit<SSHServer, 'id' | 'createdAt' | 'updatedAt'>): Promise<IPCResult<SSHServer>> => {
      try {
        const server = sshStore.addServer(serverData);
        return { success: true, data: server };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to add SSH server'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SSH_SERVER_UPDATE,
    async (_, serverId: string, updates: Partial<SSHServer>): Promise<IPCResult<SSHServer | undefined>> => {
      try {
        const server = sshStore.updateServer(serverId, updates);
        if (!server) {
          return { success: false, error: `SSH server not found: ${serverId}` };
        }
        return { success: true, data: server };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update SSH server'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SSH_SERVER_REMOVE,
    async (_, serverId: string): Promise<IPCResult<boolean>> => {
      try {
        const removed = sshStore.removeServer(serverId);
        if (!removed) {
          return { success: false, error: `SSH server not found: ${serverId}` };
        }
        return { success: true, data: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to remove SSH server'
        };
      }
    }
  );

  // ============================================
  // SSH Connection Testing
  // ============================================

  ipcMain.handle(
    IPC_CHANNELS.SSH_TEST_CONNECTION,
    async (_, serverId: string): Promise<IPCResult<SSHConnectionTestResult>> => {
      try {
        const result = await sshManager.testConnection(serverId);
        return { success: true, data: result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to test SSH connection'
        };
      }
    }
  );

  // ============================================
  // SFTP Directory Browsing
  // ============================================

  ipcMain.handle(
    IPC_CHANNELS.SSH_LIST_DIRECTORY,
    async (
      _,
      serverId: string,
      remotePath: string,
      options?: ListDirectoryOptions
    ): Promise<IPCResult<RemoteDirectoryEntry[]>> => {
      try {
        const entries = await sftpBrowser.listDirectory(serverId, remotePath, options);
        return { success: true, data: entries };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list remote directory'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SSH_GET_HOME_DIRECTORY,
    async (_, serverId: string): Promise<IPCResult<string>> => {
      try {
        const homePath = await sftpBrowser.getHomeDirectory(serverId);
        return { success: true, data: homePath };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get remote home directory'
        };
      }
    }
  );

  console.warn('[SSH] IPC handlers registered successfully');
}
