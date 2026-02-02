/**
 * SSH Server types for remote project support
 */

/**
 * Configuration for an SSH server that can host remote projects
 */
export interface SSHServer {
  /** Unique identifier */
  id: string;
  /** Display name (e.g., "home", "work-server") */
  name: string;
  /** SSH host - can be an alias from ~/.ssh/config or a hostname/IP */
  host: string;
  /** Override SSH user (optional if defined in ssh config) */
  user?: string;
  /** Override SSH port (default: 22) */
  port?: number;
  /** Path to SSH identity file (optional if using ssh-agent or default key) */
  identityFile?: string;
  /** Python interpreter path on the remote server (default: "python3") */
  pythonPath?: string;
  /** Path to Auto-Claude installation on the remote server (e.g., ~/opt/Auto-Claude) */
  autoBuildPath?: string;
  /** When the server config was created */
  createdAt: Date;
  /** When the server config was last updated */
  updatedAt: Date;
}

/**
 * Configuration for a remote project location
 */
export interface RemoteProjectConfig {
  /** Reference to the SSHServer by ID */
  serverId: string;
  /** Absolute path on the remote server (e.g., ~/projects/my-app or /home/user/projects/my-app) */
  remotePath: string;
}

/**
 * Result of testing an SSH connection
 */
export interface SSHConnectionTestResult {
  /** Whether the connection succeeded */
  success: boolean;
  /** Human-readable message */
  message: string;
  /** SSH server version string if connected */
  serverVersion?: string;
  /** Connection latency in milliseconds */
  latencyMs?: number;
  /** Error details if failed */
  error?: string;
}

/**
 * Entry in a remote directory listing
 */
export interface RemoteDirectoryEntry {
  /** File or directory name */
  name: string;
  /** Full path on the remote server */
  path: string;
  /** Whether this is a directory */
  isDirectory: boolean;
  /** File size in bytes (for files) */
  size?: number;
  /** Last modified timestamp */
  modifiedAt?: Date;
}
