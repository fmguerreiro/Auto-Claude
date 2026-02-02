/**
 * SSH Config Parser - Parse ~/.ssh/config to resolve host aliases
 *
 * The ssh2 library doesn't read SSH config files, so we need to parse them
 * manually to support Host aliases like "ssh home" -> actual hostname.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface SSHConfigHost {
  /** The Host pattern (alias) */
  host: string;
  /** Actual hostname or IP */
  hostname?: string;
  /** Port number */
  port?: number;
  /** Username */
  user?: string;
  /** Path to identity file */
  identityFile?: string;
}

/**
 * Parse SSH config file and return host configurations
 */
export function parseSSHConfig(): Map<string, SSHConfigHost> {
  const configPath = join(homedir(), '.ssh', 'config');
  const hosts = new Map<string, SSHConfigHost>();

  if (!existsSync(configPath)) {
    return hosts;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const lines = content.split('\n');

    let currentHost: SSHConfigHost | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Parse key-value pairs (handle both "Key Value" and "Key=Value")
      const match = trimmed.match(/^(\S+)\s*[=\s]\s*(.+)$/i);
      if (!match) {
        continue;
      }

      const [, key, value] = match;
      const keyLower = key.toLowerCase();

      if (keyLower === 'host') {
        // Save previous host if exists
        if (currentHost) {
          hosts.set(currentHost.host, currentHost);
        }
        // Start new host block (ignore wildcards for now)
        if (!value.includes('*') && !value.includes('?')) {
          currentHost = { host: value };
        } else {
          currentHost = null;
        }
      } else if (currentHost) {
        // Parse host-specific options
        switch (keyLower) {
          case 'hostname':
            currentHost.hostname = value;
            break;
          case 'port':
            currentHost.port = parseInt(value, 10);
            break;
          case 'user':
            currentHost.user = value;
            break;
          case 'identityfile':
            // Expand ~ in path
            currentHost.identityFile = value.startsWith('~')
              ? join(homedir(), value.slice(1))
              : value;
            break;
        }
      }
    }

    // Save last host
    if (currentHost) {
      hosts.set(currentHost.host, currentHost);
    }
  } catch {
    // Silently fail if we can't read the config
  }

  return hosts;
}

/**
 * Resolve an SSH host alias to its actual configuration
 * Returns the resolved hostname and any other configured options
 */
export function resolveSSHHost(hostAlias: string): SSHConfigHost | null {
  const hosts = parseSSHConfig();
  return hosts.get(hostAlias) || null;
}

/**
 * Get the effective hostname for an SSH host (resolving aliases)
 */
export function getEffectiveHostname(host: string): string {
  const config = resolveSSHHost(host);
  return config?.hostname || host;
}
