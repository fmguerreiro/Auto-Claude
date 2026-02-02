/**
 * SSH Server Store - Persistent storage for SSH server configurations
 */

import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { SSHServer } from '../../shared/types/ssh';

interface SSHStoreData {
  servers: SSHServer[];
}

/**
 * Manages persistent storage of SSH server configurations
 */
export class SSHStore {
  private storePath: string;
  private data: SSHStoreData;

  constructor() {
    const userDataPath = app.getPath('userData');
    const storeDir = path.join(userDataPath, 'store');

    if (!existsSync(storeDir)) {
      mkdirSync(storeDir, { recursive: true });
    }

    this.storePath = path.join(storeDir, 'ssh-servers.json');
    this.data = this.load();
  }

  /**
   * Load store from disk
   */
  private load(): SSHStoreData {
    if (existsSync(this.storePath)) {
      try {
        const content = readFileSync(this.storePath, 'utf-8');
        const data = JSON.parse(content);
        // Convert date strings back to Date objects
        data.servers = data.servers.map((s: SSHServer) => ({
          ...s,
          createdAt: new Date(s.createdAt),
          updatedAt: new Date(s.updatedAt)
        }));
        return data;
      } catch {
        return { servers: [] };
      }
    }
    return { servers: [] };
  }

  /**
   * Save store to disk
   */
  private save(): void {
    writeFileSync(this.storePath, JSON.stringify(this.data, null, 2));
  }

  /**
   * Get all configured SSH servers
   */
  getServers(): SSHServer[] {
    return this.data.servers;
  }

  /**
   * Get a server by ID
   */
  getServer(serverId: string): SSHServer | undefined {
    return this.data.servers.find((s) => s.id === serverId);
  }

  /**
   * Get a server by name
   */
  getServerByName(name: string): SSHServer | undefined {
    return this.data.servers.find((s) => s.name === name);
  }

  /**
   * Add a new SSH server
   */
  addServer(config: Omit<SSHServer, 'id' | 'createdAt' | 'updatedAt'>): SSHServer {
    // Check for duplicate names
    const existing = this.getServerByName(config.name);
    if (existing) {
      throw new Error(`SSH server with name "${config.name}" already exists`);
    }

    const server: SSHServer = {
      ...config,
      id: uuidv4(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.data.servers.push(server);
    this.save();

    return server;
  }

  /**
   * Update an existing SSH server
   */
  updateServer(
    serverId: string,
    updates: Partial<Omit<SSHServer, 'id' | 'createdAt' | 'updatedAt'>>
  ): SSHServer | undefined {
    const server = this.data.servers.find((s) => s.id === serverId);
    if (!server) {
      return undefined;
    }

    // Check for duplicate names if name is being changed
    if (updates.name && updates.name !== server.name) {
      const existingWithName = this.getServerByName(updates.name);
      if (existingWithName) {
        throw new Error(`SSH server with name "${updates.name}" already exists`);
      }
    }

    Object.assign(server, updates, { updatedAt: new Date() });
    this.save();

    return server;
  }

  /**
   * Remove an SSH server
   */
  removeServer(serverId: string): boolean {
    const index = this.data.servers.findIndex((s) => s.id === serverId);
    if (index !== -1) {
      this.data.servers.splice(index, 1);
      this.save();
      return true;
    }
    return false;
  }

  /**
   * Check if a server with the given host exists
   */
  hasServerWithHost(host: string): boolean {
    return this.data.servers.some((s) => s.host === host);
  }
}

// Singleton instance
export const sshStore = new SSHStore();
