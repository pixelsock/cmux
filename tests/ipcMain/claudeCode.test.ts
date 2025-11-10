import { setupWorkspace, shouldRunIntegrationTests } from "./setup";
import {
  sendMessageWithModel,
  createEventCollector,
  assertStreamSuccess,
  extractTextFromEvents,
} from "./helpers";
import { spawn } from "child_process";

// Skip all tests if TEST_INTEGRATION or TEST_CLAUDE_CODE is not set
// Note: These tests require the Claude CLI to be installed and authenticated
// Run `claude login` before running tests with TEST_CLAUDE_CODE=1
const shouldRunClaudeCodeTests =
  shouldRunIntegrationTests() && process.env.TEST_CLAUDE_CODE === "1";
const describeClaudeCode = shouldRunClaudeCodeTests ? describe : describe.skip;

/**
 * Check if Claude CLI is installed and authenticated
 */
async function isClaudeCodeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    // Try running `claude --version` to check if CLI is installed
    const checkProcess = spawn("claude", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    checkProcess.on("close", (code) => {
      resolve(code === 0);
    });

    checkProcess.on("error", () => {
      resolve(false);
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      checkProcess.kill();
      resolve(false);
    }, 5000);
  });
}

describeClaudeCode("IpcMain Claude Code CLI integration tests", () => {
  // Enable retries in CI for potential network flakiness
  if (process.env.CI && typeof jest !== "undefined" && jest.retryTimes) {
    jest.retryTimes(3, { logErrorsBeforeRetry: true });
  }

  let cliAvailable = false;

  // Check if Claude CLI is available before all tests
  beforeAll(async () => {
    // Load tokenizers (takes ~14s)
    const { loadTokenizerModules } = await import("../../src/utils/main/tokenizer");
    await loadTokenizerModules();

    // Check if Claude CLI is available
    cliAvailable = await isClaudeCodeAvailable();
    if (!cliAvailable) {
      console.warn(
        "⚠️  Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code"
      );
      console.warn("   Then authenticate with: claude login");
    }
  }, 150000); // 150s timeout for tokenizer loading

  test("should successfully send message to Claude Code and receive response", async () => {
    if (!cliAvailable) {
      console.log("⏭️  Skipping test - Claude CLI not available");
      return;
    }

    const { env, workspaceId, cleanup } = await setupWorkspace("claude-code");
    try {
      // Send a simple message to verify basic connectivity
      const result = await sendMessageWithModel(
        env.mockIpcRenderer,
        workspaceId,
        "Say 'hello' and nothing else",
        "claude-code",
        "sonnet" // Using shorthand model name
      );

      // Verify the IPC call succeeded
      expect(result.success).toBe(true);

      // Collect and verify stream events
      const collector = createEventCollector(env.sentEvents, workspaceId);
      const streamEnd = await collector.waitForEvent("stream-end", 60000);

      expect(streamEnd).toBeDefined();
      assertStreamSuccess(collector);

      // Verify we received deltas
      const deltas = collector.getDeltas();
      expect(deltas.length).toBeGreaterThan(0);

      // Verify the response contains expected content
      const text = extractTextFromEvents(deltas).toLowerCase();
      expect(text).toMatch(/hello/i);
    } finally {
      await cleanup();
    }
  }, 90000); // Claude Code can take longer with authentication checks

  test("should handle authentication errors gracefully", async () => {
    if (!cliAvailable) {
      console.log("⏭️  Skipping test - Claude CLI not available");
      return;
    }

    const { env, workspaceId, cleanup } = await setupWorkspace("claude-code");
    try {
      // Try to send a message - if not authenticated, should get error
      const result = await sendMessageWithModel(
        env.mockIpcRenderer,
        workspaceId,
        "Test message",
        "claude-code",
        "sonnet"
      );

      // Either succeeds (authenticated) or fails gracefully (not authenticated)
      if (!result.success) {
        expect(result.error).toBeDefined();
        // Check if error mentions authentication
        const errorStr = JSON.stringify(result.error);
        expect(errorStr).toMatch(/login|auth|credential/i);
      } else {
        // If it succeeds, verify we got a proper response
        const collector = createEventCollector(env.sentEvents, workspaceId);
        await collector.waitForEvent("stream-end", 60000);
        assertStreamSuccess(collector);
      }
    } finally {
      await cleanup();
    }
  }, 90000);

  test("should support full model names", async () => {
    if (!cliAvailable) {
      console.log("⏭️  Skipping test - Claude CLI not available");
      return;
    }

    const { env, workspaceId, cleanup } = await setupWorkspace("claude-code");
    try {
      // Use full model name instead of shorthand
      const result = await sendMessageWithModel(
        env.mockIpcRenderer,
        workspaceId,
        "Say 'working' and nothing else",
        "claude-code",
        "claude-sonnet-4-5"
      );

      expect(result.success).toBe(true);

      const collector = createEventCollector(env.sentEvents, workspaceId);
      await collector.waitForEvent("stream-end", 60000);

      assertStreamSuccess(collector);

      const deltas = collector.getDeltas();
      const text = extractTextFromEvents(deltas).toLowerCase();
      expect(text).toMatch(/working/i);
    } finally {
      await cleanup();
    }
  }, 90000);
});

// Unit tests that don't require authentication
describe("Claude Code provider configuration", () => {
  test("should accept claude-code provider without API key", async () => {
    const { Config } = await import("../../src/config");
    const config = new Config("/tmp/test-claude-code");

    // Save providers config with claude-code enabled
    config.saveProvidersConfig({
      "claude-code": {
        enabled: true,
      },
    });

    // Load it back
    const providers = config.loadProvidersConfig();
    expect(providers).toBeDefined();
    expect(providers?.["claude-code"]).toBeDefined();
    expect(providers?.["claude-code"].enabled).toBe(true);
  });

  test("should support claude-code configuration options", async () => {
    const { Config } = await import("../../src/config");
    const config = new Config("/tmp/test-claude-code-options");

    // Save providers config with various options
    config.saveProvidersConfig({
      "claude-code": {
        enabled: true,
        maxTurns: 20,
        permissionMode: "bypassPermissions",
        cwd: "/custom/working/directory",
      },
    });

    // Load it back
    const providers = config.loadProvidersConfig();
    expect(providers?.["claude-code"].maxTurns).toBe(20);
    expect(providers?.["claude-code"].permissionMode).toBe("bypassPermissions");
    expect(providers?.["claude-code"].cwd).toBe("/custom/working/directory");
  });
});
