/**
 * Runtime configuration types for workspace execution environments
 */

/** Runtime mode type - used in UI and runtime string parsing */
export type RuntimeMode = "local" | "ssh" | "terminal";

/** Runtime mode constants */
export const RUNTIME_MODE = {
  LOCAL: "local" as const,
  SSH: "ssh" as const,
  TERMINAL: "terminal" as const,
} as const;

/** Runtime string prefix for SSH mode (e.g., "ssh hostname") */
export const SSH_RUNTIME_PREFIX = "ssh ";

/** Runtime string prefix for terminal mode (e.g., "terminal /path/to/dir") */
export const TERMINAL_RUNTIME_PREFIX = "terminal ";

export type RuntimeConfig =
  | {
      type: "local";
      /** Base directory where all workspaces are stored (e.g., ~/.cmux/src) */
      srcBaseDir: string;
    }
  | {
      type: "ssh";
      /** SSH host (can be hostname, user@host, or SSH config alias) */
      host: string;
      /** Base directory on remote host where all workspaces are stored */
      srcBaseDir: string;
      /** Optional: Path to SSH private key (if not using ~/.ssh/config or ssh-agent) */
      identityFile?: string;
      /** Optional: SSH port (default: 22) */
      port?: number;
    }
  | {
      type: "terminal";
      /** Existing directory to use as workspace (user's current working directory) */
      workingDir: string;
      /** Whether to inherit environment variables from parent process */
      inheritEnv: boolean;
    };

/**
 * Parse runtime string from localStorage or UI input into mode and host
 * Format: "ssh <host>" -> { mode: "ssh", host: "<host>", workingDir: "" }
 *         "terminal <path>" -> { mode: "terminal", host: "", workingDir: "<path>" }
 *         "local" or undefined -> { mode: "local", host: "", workingDir: "" }
 *
 * Use this for UI state management (localStorage, form inputs)
 */
export function parseRuntimeModeAndHost(runtime: string | null | undefined): {
  mode: RuntimeMode;
  host: string;
  workingDir: string;
} {
  if (!runtime) {
    return { mode: RUNTIME_MODE.LOCAL, host: "", workingDir: "" };
  }

  const trimmed = runtime.trim();
  const lowerTrimmed = trimmed.toLowerCase();

  if (lowerTrimmed === RUNTIME_MODE.LOCAL) {
    return { mode: RUNTIME_MODE.LOCAL, host: "", workingDir: "" };
  }

  if (lowerTrimmed.startsWith(SSH_RUNTIME_PREFIX)) {
    const host = trimmed.substring(SSH_RUNTIME_PREFIX.length).trim();
    return { mode: RUNTIME_MODE.SSH, host, workingDir: "" };
  }

  if (lowerTrimmed.startsWith(TERMINAL_RUNTIME_PREFIX)) {
    const workingDir = trimmed.substring(TERMINAL_RUNTIME_PREFIX.length).trim();
    return { mode: RUNTIME_MODE.TERMINAL, host: "", workingDir };
  }

  // Default to local for unrecognized strings
  return { mode: RUNTIME_MODE.LOCAL, host: "", workingDir: "" };
}

/**
 * Build runtime string for storage/IPC from mode, host, and workingDir
 * Returns: "ssh <host>" for SSH, "terminal <path>" for terminal, undefined for local
 */
export function buildRuntimeString(
  mode: RuntimeMode,
  host: string,
  workingDir?: string
): string | undefined {
  if (mode === RUNTIME_MODE.SSH) {
    const trimmedHost = host.trim();
    return trimmedHost ? `${SSH_RUNTIME_PREFIX}${trimmedHost}` : undefined;
  }
  if (mode === RUNTIME_MODE.TERMINAL) {
    const trimmedDir = workingDir?.trim();
    return trimmedDir ? `${TERMINAL_RUNTIME_PREFIX}${trimmedDir}` : undefined;
  }
  return undefined;
}
