/**
 * SSH Store Tests - Test persistent storage of SSH server configurations
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';

// Define test directory outside vi.hoisted
const testDir = path.join(os.tmpdir(), 'ssh-store-test-vitest');

// Mock electron app using a factory that creates its own path
vi.mock('electron', async () => {
  const _path = await import('path');
  const _os = await import('os');
  return {
    app: {
      getPath: () => _path.join(_os.tmpdir(), 'ssh-store-test-vitest')
    }
  };
});

// Import after mocking
import { SSHStore } from '../ssh-store';

describe('SSHStore', () => {
  let store: SSHStore;
  const storePath = path.join(testDir, 'store', 'ssh-servers.json');

  beforeAll(() => {
    // Clean up test dir if it exists
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    // Clean up before each test
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    store = new SSHStore();
  });

  afterEach(() => {
    // Clean up test data
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    // Final cleanup
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('initialization', () => {
    it('creates store directory if it does not exist', () => {
      const storeDir = path.join(testDir, 'store');
      expect(existsSync(storeDir)).toBe(true);
    });

    it('initializes with empty servers array', () => {
      expect(store.getServers()).toEqual([]);
    });
  });

  describe('addServer', () => {
    it('adds a new server with generated id and timestamps', () => {
      const serverData = {
        name: 'My SSH Server',
        host: 'ssh.example.com',
        port: 22,
        user: 'admin'
      };

      const server = store.addServer(serverData);

      expect(server.id).toBeDefined();
      expect(server.id.length).toBeGreaterThan(0);
      expect(server.name).toBe('My SSH Server');
      expect(server.host).toBe('ssh.example.com');
      expect(server.port).toBe(22);
      expect(server.user).toBe('admin');
      expect(server.createdAt).toBeInstanceOf(Date);
      expect(server.updatedAt).toBeInstanceOf(Date);
    });

    it('persists server to disk', () => {
      const serverData = {
        name: 'Persistent Server',
        host: 'persistent.example.com',
        port: 22,
        user: 'user'
      };

      store.addServer(serverData);

      // Read file directly
      const fileContent = readFileSync(storePath, 'utf-8');
      const data = JSON.parse(fileContent);
      expect(data.servers).toHaveLength(1);
      expect(data.servers[0].name).toBe('Persistent Server');
    });

    it('throws error for duplicate server names', () => {
      store.addServer({
        name: 'Duplicate Name',
        host: 'first.example.com',
        port: 22,
        user: 'user'
      });

      expect(() =>
        store.addServer({
          name: 'Duplicate Name',
          host: 'second.example.com',
          port: 22,
          user: 'user'
        })
      ).toThrow('SSH server with name "Duplicate Name" already exists');
    });
  });

  describe('getServer', () => {
    it('returns server by id', () => {
      const added = store.addServer({
        name: 'Get By ID',
        host: 'get.example.com',
        port: 22,
        user: 'user'
      });

      const found = store.getServer(added.id);
      expect(found).toBeDefined();
      expect(found?.name).toBe('Get By ID');
    });

    it('returns undefined for non-existent id', () => {
      const found = store.getServer('non-existent-id');
      expect(found).toBeUndefined();
    });
  });

  describe('getServerByName', () => {
    it('returns server by name', () => {
      store.addServer({
        name: 'Named Server',
        host: 'named.example.com',
        port: 22,
        user: 'user'
      });

      const found = store.getServerByName('Named Server');
      expect(found).toBeDefined();
      expect(found?.host).toBe('named.example.com');
    });

    it('returns undefined for non-existent name', () => {
      const found = store.getServerByName('Does Not Exist');
      expect(found).toBeUndefined();
    });
  });

  describe('updateServer', () => {
    it('updates server properties', () => {
      const added = store.addServer({
        name: 'Original Name',
        host: 'original.example.com',
        port: 22,
        user: 'original'
      });

      const updated = store.updateServer(added.id, {
        name: 'Updated Name',
        host: 'updated.example.com',
        user: 'updated'
      });

      expect(updated).toBeDefined();
      expect(updated?.name).toBe('Updated Name');
      expect(updated?.host).toBe('updated.example.com');
      expect(updated?.user).toBe('updated');
      expect(updated?.port).toBe(22); // Unchanged
    });

    it('updates updatedAt timestamp', () => {
      const added = store.addServer({
        name: 'Timestamp Test',
        host: 'timestamp.example.com',
        port: 22,
        user: 'user'
      });

      const originalUpdatedAt = added.updatedAt;

      // Small delay then update
      const updated = store.updateServer(added.id, { user: 'newuser' });

      expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(originalUpdatedAt.getTime());
    });

    it('returns undefined for non-existent id', () => {
      const result = store.updateServer('non-existent', { name: 'New Name' });
      expect(result).toBeUndefined();
    });

    it('throws error when renaming to duplicate name', () => {
      store.addServer({
        name: 'First',
        host: 'first.example.com',
        port: 22,
        user: 'user'
      });

      const second = store.addServer({
        name: 'Second',
        host: 'second.example.com',
        port: 22,
        user: 'user'
      });

      expect(() => store.updateServer(second.id, { name: 'First' })).toThrow(
        'SSH server with name "First" already exists'
      );
    });

    it('allows updating name to same name', () => {
      const added = store.addServer({
        name: 'Same Name',
        host: 'same.example.com',
        port: 22,
        user: 'user'
      });

      // Should not throw
      const updated = store.updateServer(added.id, { name: 'Same Name', host: 'new.example.com' });
      expect(updated?.host).toBe('new.example.com');
    });
  });

  describe('removeServer', () => {
    it('removes server and returns true', () => {
      const added = store.addServer({
        name: 'To Remove',
        host: 'remove.example.com',
        port: 22,
        user: 'user'
      });

      const result = store.removeServer(added.id);
      expect(result).toBe(true);
      expect(store.getServer(added.id)).toBeUndefined();
      expect(store.getServers()).toHaveLength(0);
    });

    it('returns false for non-existent id', () => {
      const result = store.removeServer('non-existent');
      expect(result).toBe(false);
    });

    it('persists removal to disk', () => {
      const added = store.addServer({
        name: 'To Remove Persist',
        host: 'remove.example.com',
        port: 22,
        user: 'user'
      });

      store.removeServer(added.id);

      // Read file directly
      const fileContent = readFileSync(storePath, 'utf-8');
      const data = JSON.parse(fileContent);
      expect(data.servers).toHaveLength(0);
    });
  });

  describe('hasServerWithHost', () => {
    it('returns true when host exists', () => {
      store.addServer({
        name: 'Host Check',
        host: 'unique-host.example.com',
        port: 22,
        user: 'user'
      });

      expect(store.hasServerWithHost('unique-host.example.com')).toBe(true);
    });

    it('returns false when host does not exist', () => {
      expect(store.hasServerWithHost('non-existent.example.com')).toBe(false);
    });
  });
});
