/**
 * SSH Module - Remote project support via SSH
 *
 * Provides:
 * - SSHStore: Persistent storage for SSH server configurations
 * - SSHManager: Connection testing and remote process spawning
 * - SFTPBrowser: Remote directory browsing for project selection
 * - SSH Config Parser: Resolves ~/.ssh/config aliases for ssh2 library
 */

export { SSHStore, sshStore } from './ssh-store';
export { SSHManager, sshManager, type RemoteSpawnOptions } from './ssh-manager';
export { SFTPBrowser, sftpBrowser, type ListDirectoryOptions } from './sftp-browser';
export {
  parseSSHConfig,
  resolveSSHHost,
  getEffectiveHostname,
  type SSHConfigHost
} from './ssh-config-parser';
