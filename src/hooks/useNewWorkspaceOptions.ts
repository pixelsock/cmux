import { useState, useEffect } from "react";
import { getRuntimeKey } from "@/constants/storage";
import {
  type RuntimeMode,
  RUNTIME_MODE,
  parseRuntimeModeAndHost,
  buildRuntimeString,
} from "@/types/runtime";

export interface WorkspaceRuntimeOptions {
  runtimeMode: RuntimeMode;
  sshHost: string;
  workingDir: string;
  /**
   * Returns the runtime string for IPC calls (format: "ssh <host>", "terminal <path>", or undefined for local)
   */
  getRuntimeString: () => string | undefined;
}

/**
 * Hook to manage workspace creation runtime options with localStorage persistence.
 * Loads saved runtime preference for a project and provides consistent state management.
 *
 * @param projectPath - Path to the project (used as key for localStorage)
 * @returns Runtime options state and setter
 */
export function useNewWorkspaceOptions(
  projectPath: string | null | undefined
): [WorkspaceRuntimeOptions, (mode: RuntimeMode, host?: string, workingDir?: string) => void] {
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>(RUNTIME_MODE.LOCAL);
  const [sshHost, setSshHost] = useState("");
  const [workingDir, setWorkingDir] = useState("");

  // Load saved runtime preference when projectPath changes
  useEffect(() => {
    if (!projectPath) {
      // Reset to defaults when no project
      setRuntimeMode(RUNTIME_MODE.LOCAL);
      setSshHost("");
      setWorkingDir("");
      return;
    }

    const runtimeKey = getRuntimeKey(projectPath);
    const savedRuntime = localStorage.getItem(runtimeKey);
    const parsed = parseRuntimeModeAndHost(savedRuntime);

    setRuntimeMode(parsed.mode);
    setSshHost(parsed.host);
    setWorkingDir(parsed.workingDir);
  }, [projectPath]);

  // Setter for updating mode, host, and workingDir
  const setRuntimeOptions = (mode: RuntimeMode, host?: string, dir?: string) => {
    setRuntimeMode(mode);
    setSshHost(host ?? "");
    setWorkingDir(dir ?? "");
  };

  // Helper to get runtime string for IPC calls
  const getRuntimeString = (): string | undefined => {
    return buildRuntimeString(runtimeMode, sshHost, workingDir);
  };

  return [
    {
      runtimeMode,
      sshHost,
      workingDir,
      getRuntimeString,
    },
    setRuntimeOptions,
  ];
}
