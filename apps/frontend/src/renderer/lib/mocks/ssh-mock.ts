/**
 * SSH Mock - Mock implementations for SSH server operations
 */
import type { SSHServer, SSHConnectionTestResult, RemoteDirectoryEntry } from '../../../shared/types/ssh';
import type { IPCResult } from '../../../shared/types';

// Mock SSH servers
const mockServers: SSHServer[] = [
  {
    id: 'mock-server-1',
    name: 'Development Server',
    host: '192.168.1.100',
    port: 22,
    user: 'dev',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01')
  }
];

export const sshMock = {
  listSSHServers: async (): Promise<IPCResult<SSHServer[]>> => ({
    success: true,
    data: mockServers
  }),

  getSSHServer: async (serverId: string): Promise<IPCResult<SSHServer | undefined>> => ({
    success: true,
    data: mockServers.find(s => s.id === serverId)
  }),

  addSSHServer: async (
    serverData: Omit<SSHServer, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<IPCResult<SSHServer>> => {
    const newServer: SSHServer = {
      ...serverData,
      id: `mock-server-${Date.now()}`,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    mockServers.push(newServer);
    return { success: true, data: newServer };
  },

  updateSSHServer: async (
    serverId: string,
    updates: Partial<SSHServer>
  ): Promise<IPCResult<SSHServer | undefined>> => {
    const index = mockServers.findIndex(s => s.id === serverId);
    if (index === -1) {
      return { success: false, error: 'Server not found' };
    }
    mockServers[index] = { ...mockServers[index], ...updates, updatedAt: new Date() };
    return { success: true, data: mockServers[index] };
  },

  removeSSHServer: async (serverId: string): Promise<IPCResult<boolean>> => {
    const index = mockServers.findIndex(s => s.id === serverId);
    if (index === -1) {
      return { success: false, error: 'Server not found' };
    }
    mockServers.splice(index, 1);
    return { success: true, data: true };
  },

  testSSHConnection: async (_serverId: string): Promise<IPCResult<SSHConnectionTestResult>> => ({
    success: true,
    data: {
      success: true,
      message: 'Connected successfully (mock)',
      serverVersion: 'OpenSSH_8.9p1 Ubuntu-3ubuntu0.1',
      latencyMs: 25
    }
  }),

  listRemoteDirectory: async (
    _serverId: string,
    remotePath: string,
    _options?: { showHidden?: boolean; directoriesOnly?: boolean }
  ): Promise<IPCResult<RemoteDirectoryEntry[]>> => ({
    success: true,
    data: [
      { name: 'projects', path: `${remotePath}/projects`, isDirectory: true },
      { name: 'Documents', path: `${remotePath}/Documents`, isDirectory: true },
      { name: '.bashrc', path: `${remotePath}/.bashrc`, isDirectory: false, size: 1234 }
    ]
  }),

  getRemoteHomeDirectory: async (_serverId: string): Promise<IPCResult<string>> => ({
    success: true,
    data: '/home/dev'
  })
};
