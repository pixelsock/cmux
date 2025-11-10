## Models

See also:

- [System Prompt](./system-prompt.md)

cmux supports multiple AI providers through its flexible provider architecture.

### Supported Providers

#### Anthropic (Cloud)

Best supported provider with full feature support:

- `anthropic:claude-sonnet-4-5`
- `anthropic:claude-opus-4-1`

#### Claude Code CLI (Subscription)

Use your Claude subscription (Pro/Max/Team) without API keys:

- `claude-code:claude-sonnet-4-5`
- `claude-code:claude-opus-4-1`
- `claude-code:sonnet` (shorthand)
- `claude-code:opus` (shorthand)
- `claude-code:haiku` (shorthand)

**No API key required** - uses OAuth authentication through the Claude CLI. This lets you use your included subscription credits instead of paying per-token API fees.

**Setup:**

1. Install the Claude CLI:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

2. Log in with your Claude subscription:
   ```bash
   claude login
   ```
   Follow the browser OAuth flow to authenticate with your Claude Pro/Max/Team account.

3. Add to `~/.cmux/providers.jsonc`:
   ```jsonc
   {
     "claude-code": {
       "enabled": true
     }
   }
   ```

**Optional Configuration:**

```jsonc
{
  "claude-code": {
    "enabled": true,
    "maxTurns": 10,
    "permissionMode": "default",
    "pathToClaudeCodeExecutable": "/custom/path/to/claude"
  }
}
```

**Important:** Make sure `ANTHROPIC_API_KEY` is not set in your environment, as the Claude CLI will prioritize API key authentication over your subscription if present.

#### OpenAI (Cloud)

GPT-5 family of models:

- `openai:gpt-5`
- `openai:gpt-5-pro`
- `openai:gpt-5-codex`

**Note:** Anthropic models are better supported than GPT-5 class models due to an outstanding issue in the Vercel AI SDK.

TODO: add issue link here.

#### Ollama (Local)

Run models locally with Ollama. No API key required:

- `ollama:gpt-oss:20b`
- `ollama:gpt-oss:120b`
- `ollama:qwen3-coder:30b`
- Any model from the [Ollama Library](https://ollama.com/library)

**Setup:**

1. Install Ollama from [ollama.com](https://ollama.com)
2. Pull a model: `ollama pull gpt-oss:20b`
3. That's it! Ollama works out-of-the-box with no configuration needed.

**Custom Configuration** (optional):

By default, cmux connects to Ollama at `http://localhost:11434/api`. To use a remote instance or custom port, add to `~/.cmux/providers.jsonc`:

```jsonc
{
  "ollama": {
    "baseUrl": "http://your-server:11434/api",
  },
}
```

### Provider Configuration

All providers are configured in `~/.cmux/providers.jsonc`. Example configurations:

```jsonc
{
  // Required for Anthropic models
  "anthropic": {
    "apiKey": "sk-ant-...",
  },
  // Required for OpenAI models
  "openai": {
    "apiKey": "sk-...",
  },
  // Optional for Ollama (only needed for custom URL)
  "ollama": {
    "baseUrl": "http://your-server:11434/api",
  },
  // Optional for Claude Code CLI (uses subscription credits)
  "claude-code": {
    "enabled": true
  }
}
```

### Model Selection

The quickest way to switch models is with the keyboard shortcut:

- **macOS:** `Cmd+/`
- **Windows/Linux:** `Ctrl+/`

Alternatively, use the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

1. Type "model"
2. Select "Change Model"
3. Choose from available models

Models are specified in the format: `provider:model-name`
