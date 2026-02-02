/**
 * SSH Module - Remote project support via SSH
 *
 * Provides:
 * - SSHStore: Persistent storage for SSH server configurations
 * - SSHManager: Connection testing and remote process spawning
 */

export { SSHStore, sshStore } from './ssh-store';
export { SSHManager, sshManager, type RemoteSpawnOptions } from './ssh-manager';
