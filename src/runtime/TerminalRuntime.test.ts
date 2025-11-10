import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { TerminalRuntime } from "./TerminalRuntime";

describe("TerminalRuntime", () => {
  let tempDir: string;
  let runtime: TerminalRuntime;

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "terminal-runtime-test-"));

    // Initialize a git repo in the temp directory
    await fs.mkdir(path.join(tempDir, ".git"));

    runtime = new TerminalRuntime(tempDir, true);
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("exec runs command in working directory", async () => {
    const result = await runtime.exec("echo hello", {
      cwd: tempDir,
      timeout: 5,
    });

    const decoder = new TextDecoder();
    const reader = result.stdout.getReader();
    const { value } = await reader.read();
    const output = decoder.decode(value);

    expect(output.trim()).toBe("hello");
    expect(await result.exitCode).toBe(0);
  });

  test("exec inherits environment when inheritEnv is true", async () => {
    // Set a test env var
    const testEnvVar = "TERMINAL_RUNTIME_TEST_VAR";
    const testEnvValue = "test-value-12345";
    process.env[testEnvVar] = testEnvValue;

    try {
      const runtimeWithEnv = new TerminalRuntime(tempDir, true);
      const result = await runtimeWithEnv.exec(`echo $${testEnvVar}`, {
        cwd: tempDir,
        timeout: 5,
      });

      const decoder = new TextDecoder();
      const reader = result.stdout.getReader();
      const { value } = await reader.read();
      const output = decoder.decode(value);

      expect(output.trim()).toBe(testEnvValue);
    } finally {
      delete process.env[testEnvVar];
    }
  });

  test("exec does not inherit environment when inheritEnv is false", async () => {
    const testEnvVar = "TERMINAL_RUNTIME_TEST_VAR_2";
    const testEnvValue = "test-value-67890";
    process.env[testEnvVar] = testEnvValue;

    try {
      const runtimeNoEnv = new TerminalRuntime(tempDir, false);
      const result = await runtimeNoEnv.exec(`echo $${testEnvVar}`, {
        cwd: tempDir,
        timeout: 5,
      });

      const decoder = new TextDecoder();
      const reader = result.stdout.getReader();
      const { value } = await reader.read();
      const output = decoder.decode(value);

      // Should be empty because env var is not inherited
      expect(output.trim()).toBe("");
    } finally {
      delete process.env[testEnvVar];
    }
  });

  test("createWorkspace validates directory exists", async () => {
    const result = await runtime.createWorkspace({
      projectPath: "/fake/path",
      branchName: "test-branch",
      trunkBranch: "main",
      directoryName: "test",
      initLogger: {
        logStep: () => {},
        logStdout: () => {},
        logStderr: () => {},
        logComplete: () => {},
      },
    });

    expect(result.success).toBe(true);
    expect(result.workspacePath).toBe(tempDir);
  });

  test("createWorkspace fails for non-existent directory", async () => {
    const badRuntime = new TerminalRuntime("/non/existent/path", true);
    const result = await badRuntime.createWorkspace({
      projectPath: "/fake/path",
      branchName: "test-branch",
      trunkBranch: "main",
      directoryName: "test",
      initLogger: {
        logStep: () => {},
        logStdout: () => {},
        logStderr: () => {},
        logComplete: () => {},
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("does not exist");
  });

  test("createWorkspace fails for non-git directory", async () => {
    const nonGitDir = await fs.mkdtemp(path.join(os.tmpdir(), "non-git-test-"));

    try {
      const badRuntime = new TerminalRuntime(nonGitDir, true);
      const result = await badRuntime.createWorkspace({
        projectPath: "/fake/path",
        branchName: "test-branch",
        trunkBranch: "main",
        directoryName: "test",
        initLogger: {
          logStep: () => {},
          logStdout: () => {},
          logStderr: () => {},
          logComplete: () => {},
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not a git repository");
    } finally {
      await fs.rm(nonGitDir, { recursive: true, force: true });
    }
  });

  test("getWorkspacePath returns working directory", () => {
    const path = runtime.getWorkspacePath("/any/project", "any-name");
    expect(path).toBe(tempDir);
  });

  test("forkWorkspace returns error (not supported)", async () => {
    const result = await runtime.forkWorkspace({
      sourceWorkspacePath: tempDir,
      targetWorkspacePath: "/other/path",
      newBranchName: "new-branch",
      initLogger: {
        logStep: () => {},
        logStdout: () => {},
        logStderr: () => {},
        logComplete: () => {},
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not supported");
  });
});
