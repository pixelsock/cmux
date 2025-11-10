import { spawn } from "child_process";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";
import { Readable, Writable } from "stream";
import type {
  Runtime,
  ExecOptions,
  ExecStream,
  FileStat,
  WorkspaceCreationParams,
  WorkspaceCreationResult,
  WorkspaceInitParams,
  WorkspaceInitResult,
  WorkspaceForkParams,
  WorkspaceForkResult,
  InitLogger,
} from "./Runtime";
import { RuntimeError as RuntimeErrorClass } from "./Runtime";
import { NON_INTERACTIVE_ENV_VARS } from "../constants/env";
import { EXIT_CODE_ABORTED, EXIT_CODE_TIMEOUT } from "../constants/exitCodes";
import { DisposableProcess } from "../utils/disposableExec";
import { getErrorMessage } from "../utils/errors";

/**
 * Terminal runtime implementation that executes commands in an existing directory
 * (typically the user's current working directory) without creating git worktrees.
 *
 * This mode is designed for single-agent workflows where the user wants cmux to
 * work directly in their existing project directory, similar to Claude Code CLI.
 *
 * Key differences from LocalRuntime:
 * - No worktree creation/management
 * - Can inherit environment variables from parent process
 * - Works in a single existing directory
 * - Not suitable for parallel multi-agent workflows
 */
export class TerminalRuntime implements Runtime {
  private readonly workingDir: string;
  private readonly inheritEnv: boolean;

  constructor(workingDir: string, inheritEnv: boolean = true) {
    this.workingDir = workingDir;
    this.inheritEnv = inheritEnv;
  }

  async exec(command: string, options: ExecOptions): Promise<ExecStream> {
    const startTime = performance.now();

    // Use the specified working directory (must be the terminal's working directory)
    const cwd = options.cwd;

    // Check if working directory exists before spawning
    try {
      await fsPromises.access(cwd);
    } catch (err) {
      throw new RuntimeErrorClass(
        `Working directory does not exist: ${cwd}`,
        "exec",
        err instanceof Error ? err : undefined
      );
    }

    // If niceness is specified, spawn nice directly to avoid escaping issues
    const spawnCommand = options.niceness !== undefined ? "nice" : "bash";
    const bashPath = "bash";
    const spawnArgs =
      options.niceness !== undefined
        ? ["-n", options.niceness.toString(), bashPath, "-c", command]
        : ["-c", command];

    // Build environment: inherit parent env if configured, then apply custom env vars
    const env = this.inheritEnv
      ? {
          ...process.env, // Inherit ALL env vars (including auth tokens)
          ...(options.env ?? {}), // Override with custom vars
          ...NON_INTERACTIVE_ENV_VARS, // Force non-interactive mode
        }
      : {
          ...(options.env ?? {}), // Only custom vars
          ...NON_INTERACTIVE_ENV_VARS, // Force non-interactive mode
        };

    const childProcess = spawn(spawnCommand, spawnArgs, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });

    // Wrap in DisposableProcess for automatic cleanup
    const disposable = new DisposableProcess(childProcess);

    // Convert Node.js streams to Web Streams
    const stdout = Readable.toWeb(childProcess.stdout) as unknown as ReadableStream<Uint8Array>;
    const stderr = Readable.toWeb(childProcess.stderr) as unknown as ReadableStream<Uint8Array>;
    const stdin = Writable.toWeb(childProcess.stdin) as unknown as WritableStream<Uint8Array>;

    // Track if we killed the process due to timeout or abort
    let timedOut = false;
    let aborted = false;

    // Create promises for exit code and duration
    const exitCode = new Promise<number>((resolve, reject) => {
      childProcess.on("exit", (code) => {
        // Clean up any background processes (process group cleanup)
        if (childProcess.pid !== undefined) {
          try {
            process.kill(-childProcess.pid, "SIGKILL");
          } catch {
            // Process group already dead or doesn't exist - ignore
          }
        }

        // Check abort first (highest priority)
        if (aborted || options.abortSignal?.aborted) {
          resolve(EXIT_CODE_ABORTED);
          return;
        }
        // Check if we killed the process due to timeout
        if (timedOut) {
          resolve(EXIT_CODE_TIMEOUT);
          return;
        }
        resolve(code ?? 0);
      });

      childProcess.on("error", (err) => {
        reject(new RuntimeErrorClass(`Failed to execute command: ${err.message}`, "exec", err));
      });
    });

    const duration = exitCode.then(() => performance.now() - startTime);

    // Register process group cleanup with DisposableProcess
    disposable.addCleanup(() => {
      if (childProcess.pid === undefined) return;

      try {
        process.kill(-childProcess.pid, "SIGKILL");
      } catch {
        // Process group already dead or doesn't exist - ignore
      }
    });

    // Handle abort signal
    if (options.abortSignal) {
      options.abortSignal.addEventListener("abort", () => {
        aborted = true;
        disposable[Symbol.dispose]();
      });
    }

    // Handle timeout
    if (options.timeout !== undefined) {
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        disposable[Symbol.dispose]();
      }, options.timeout * 1000);

      void exitCode.finally(() => clearTimeout(timeoutHandle));
    }

    return { stdout, stderr, stdin, exitCode, duration };
  }

  readFile(filePath: string, _abortSignal?: AbortSignal): ReadableStream<Uint8Array> {
    const nodeStream = fs.createReadStream(filePath);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;

    return new ReadableStream<Uint8Array>({
      async start(controller: ReadableStreamDefaultController<Uint8Array>) {
        try {
          const reader = webStream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          controller.close();
        } catch (err) {
          controller.error(
            new RuntimeErrorClass(
              `Failed to read file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
              "file_io",
              err instanceof Error ? err : undefined
            )
          );
        }
      },
    });
  }

  writeFile(filePath: string, _abortSignal?: AbortSignal): WritableStream<Uint8Array> {
    let tempPath: string;
    let writer: WritableStreamDefaultWriter<Uint8Array>;
    let resolvedPath: string;
    let originalMode: number | undefined;

    return new WritableStream<Uint8Array>({
      async start() {
        try {
          resolvedPath = await fsPromises.realpath(filePath);
          const stat = await fsPromises.stat(resolvedPath);
          originalMode = stat.mode;
        } catch {
          resolvedPath = filePath;
          originalMode = undefined;
        }

        const parentDir = path.dirname(resolvedPath);
        await fsPromises.mkdir(parentDir, { recursive: true });

        tempPath = `${resolvedPath}.tmp.${Date.now()}`;
        const nodeStream = fs.createWriteStream(tempPath);
        const webStream = Writable.toWeb(nodeStream) as WritableStream<Uint8Array>;
        writer = webStream.getWriter();
      },
      async write(chunk: Uint8Array) {
        await writer.write(chunk);
      },
      async close() {
        await writer.close();
        try {
          if (originalMode !== undefined) {
            await fsPromises.chmod(tempPath, originalMode);
          }
          await fsPromises.rename(tempPath, resolvedPath);
        } catch (err) {
          throw new RuntimeErrorClass(
            `Failed to write file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
            "file_io",
            err instanceof Error ? err : undefined
          );
        }
      },
      async abort(reason) {
        try {
          await writer.abort(reason);
          await fsPromises.unlink(tempPath);
        } catch {
          // Ignore cleanup errors on abort
        }
      },
    });
  }

  async stat(filePath: string, _abortSignal?: AbortSignal): Promise<FileStat> {
    try {
      const stats = await fsPromises.stat(filePath);
      return {
        size: stats.size,
        modifiedTime: stats.mtime,
        isDirectory: stats.isDirectory(),
      };
    } catch (err) {
      throw new RuntimeErrorClass(
        `Failed to stat file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        "file_io",
        err instanceof Error ? err : undefined
      );
    }
  }

  /**
   * Terminal mode doesn't create workspaces - it validates the existing directory
   */
  async createWorkspace(params: WorkspaceCreationParams): Promise<WorkspaceCreationResult> {
    try {
      params.initLogger.logStep("Validating directory exists");

      // Check if the working directory exists
      try {
        await fsPromises.access(this.workingDir);
      } catch {
        return {
          success: false,
          error: `Directory does not exist: ${this.workingDir}`,
        };
      }

      // Check if it's a git repository
      const gitDir = path.join(this.workingDir, ".git");
      try {
        await fsPromises.access(gitDir);
      } catch {
        return {
          success: false,
          error: `Directory is not a git repository: ${this.workingDir}`,
        };
      }

      params.initLogger.logStep("Directory validated successfully");

      return {
        success: true,
        workspacePath: this.workingDir,
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to validate directory: ${getErrorMessage(err)}`,
      };
    }
  }

  /**
   * Terminal mode doesn't initialize workspaces - directory is already set up
   */
  async initWorkspace(_params: WorkspaceInitParams): Promise<WorkspaceInitResult> {
    // No initialization needed for terminal mode
    return { success: true };
  }

  /**
   * Terminal mode doesn't support forking (single directory)
   */
  async forkWorkspace(_params: WorkspaceForkParams): Promise<WorkspaceForkResult> {
    return {
      success: false,
      error: "Forking workspaces is not supported in terminal mode",
    };
  }

  /**
   * Terminal mode doesn't support removal (we don't manage the directory)
   */
  async removeWorkspace(_workspacePath: string, _abortSignal?: AbortSignal): Promise<void> {
    // Do nothing - we don't manage the directory in terminal mode
    // The user is responsible for their own directory
  }

  /**
   * Get the working directory path (always returns the configured directory)
   */
  getWorkspacePath(_projectPath: string, _directoryName: string): string {
    return this.workingDir;
  }

  /**
   * Get source base directory (not applicable for terminal mode)
   */
  getSrcBaseDir(): string {
    return path.dirname(this.workingDir);
  }

  /**
   * Resolve tilde paths (pass through for terminal mode)
   */
  async resolvePath(pathStr: string): Promise<string> {
    return pathStr;
  }
}
