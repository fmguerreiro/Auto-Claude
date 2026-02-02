/**
 * SSH API - Preload API for SSH remote project support
 *
 * Provides IPC wrappers for:
 * - SSH server management (CRUD operations)
 * - Connection testing
 * - Remote directory browsing via SFTP
 */

import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';
import type {
  SSHServer,
  SSHConnectionTestResult,
  RemoteDirectoryEntry
} from '../../shared/types/ssh';
import type { ListDirectoryOptions } from '../../main/ssh';

export interface SSHApi {
  // SSH Server Management
  listSSHServers: () => Promise<IPCResult<SSHServer[]>>;
  getSSHServer: (serverId: string) => Promise<IPCResult<SSHServer | undefined>>;
  addSSHServer: (serverData: Omit<SSHServer, 'id' | 'createdAt' | 'updatedAt'>) => Promise<IPCResult<SSHServer>>;
  updateSSHServer: (serverId: string, updates: Partial<SSHServer>) => Promise<IPCResult<SSHServer | undefined>>;
  removeSSHServer: (serverId: string) => Promise<IPCResult<boolean>>;

  // SSH Connection Testing
  testSSHConnection: (serverId: string) => Promise<IPCResult<SSHConnectionTestResult>>;

  // SFTP Directory Browsing
  listRemoteDirectory: (
    serverId: string,
    remotePath: string,
    options?: ListDirectoryOptions
  ) => Promise<IPCResult<RemoteDirectoryEntry[]>>;
  getRemoteHomeDirectory: (serverId: string) => Promise<IPCResult<string>>;
}

export const createSSHApi = (): SSHApi => ({
  // SSH Server Management
  listSSHServers: (): Promise<IPCResult<SSHServer[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.SSH_SERVER_LIST),

  getSSHServer: (serverId: string): Promise<IPCResult<SSHServer | undefined>> =>
    ipcRenderer.invoke(IPC_CHANNELS.SSH_SERVER_GET, serverId),

  addSSHServer: (
    serverData: Omit<SSHServer, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<IPCResult<SSHServer>> =>
    ipcRenderer.invoke(IPC_CHANNELS.SSH_SERVER_ADD, serverData),

  updateSSHServer: (
    serverId: string,
    updates: Partial<SSHServer>
  ): Promise<IPCResult<SSHServer | undefined>> =>
    ipcRenderer.invoke(IPC_CHANNELS.SSH_SERVER_UPDATE, serverId, updates),

  removeSSHServer: (serverId: string): Promise<IPCResult<boolean>> =>
    ipcRenderer.invoke(IPC_CHANNELS.SSH_SERVER_REMOVE, serverId),

  // SSH Connection Testing
  testSSHConnection: (serverId: string): Promise<IPCResult<SSHConnectionTestResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.SSH_TEST_CONNECTION, serverId),

  // SFTP Directory Browsing
  listRemoteDirectory: (
    serverId: string,
    remotePath: string,
    options?: ListDirectoryOptions
  ): Promise<IPCResult<RemoteDirectoryEntry[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.SSH_LIST_DIRECTORY, serverId, remotePath, options),

  getRemoteHomeDirectory: (serverId: string): Promise<IPCResult<string>> =>
    ipcRenderer.invoke(IPC_CHANNELS.SSH_GET_HOME_DIRECTORY, serverId)
});
