# Qwen Code, DeepSeek and Kimi

Validated against Qwen Code 0.23.0 on 2026-09-08. Yoke's execution provider remains
`qwen`: Qwen Code supplies the coding tools and connects to the selected model API.
DeepSeek and Kimi do not require imaginary `deepseek` or `kimi` executables.

## Setup

Install Qwen Code and configure/authenticate the account you want to use. For an
existing Qwen Code model configuration:

```sh
yoke setup . --yes --agent=qwen
```

The default `qwen-standard` routing worker uses Qwen Code's configured model. It
no longer assumes an account can access four particular Qwen API models or calls
the same model different intelligence tiers. Existing custom workers are kept.
Use `--routing-preset` to explicitly reset old generated workers; otherwise edit
`.yoke/config.yaml` to retain your own measured profiles. A single standard profile
cannot satisfy stronger prepared assessments: add suitable explicit workers before
running those tasks, or choose an appropriate configured routing fallback.

For the opt-in DeepSeek and/or Kimi API presets:

```sh
yoke setup . --yes --agent=qwen --runner=qwen --model-provider=deepseek,kimi
```

Provide `DEEPSEEK_API_KEY` and `MOONSHOT_API_KEY` in the environment of the Qwen
process. Setup stores only their **variable names**, never key values, in
`.qwen/settings.json`. These are separate API accounts/billing; the Kimi preset
uses Moonshot's platform API, not Kimi Code subscription credentials. Select only
providers whose credentials you have configured. Setup does not contact either API
or prove authentication. Commit the generated project configuration and skills
before using isolated Git worktrees so the worker receives them.

| Preset | Models installed | Endpoint | Key variable |
| --- | --- | --- | --- |
| `deepseek` | `deepseek-v4-flash`, `deepseek-v4-pro` | `https://api.deepseek.com/v1` | `DEEPSEEK_API_KEY` |
| `kimi` | `kimi-k2.6`, `kimi-k2.7-code`, `kimi-k3` | `https://api.moonshot.ai/v1` | `MOONSHOT_API_KEY` |

New API workers use `openai::MODEL` in Yoke. The adapter translates this to Qwen's
`--auth-type openai --model MODEL`, selecting the model's endpoint and environment
key together even when Qwen's default login uses another protocol. Plain model IDs
keep their existing behavior. The same explicit selector syntax supports `anthropic`,
`gemini`, `vertex-ai` and `qwen-oauth` when configured in Qwen Code; only DeepSeek and
Kimi have new automatic API presets.

Example runner or routing worker:

```yaml
runner:
  agent: qwen
  model: openai::kimi-k3
routing:
  enabled: true
  strategy: capability
  maxCandidates: 3
  workers:
    - id: deepseek-standard
      agent: qwen
      model: openai::deepseek-v4-flash
      tier: standard
      costTier: low
      capabilities: [implementation]
    - id: kimi-frontier
      agent: qwen
      model: openai::kimi-k3
      tier: frontier
      costTier: high
      capabilities: [implementation]
```

Setup preserves existing endpoint/key/generation settings for a matching model ID,
existing custom worker IDs and an existing runner unless explicitly changed. It
adds missing preset entries and creates backups for changed settings. Regional or
self-hosted endpoints can be configured directly in Qwen's `modelProviders.openai`.
Avoid ambiguous duplicate model IDs across endpoints when selecting with `--model`.
Worker tiers and cost tiers are editable starting hypotheses, not measured rankings
or prices. Yoke accepts up to 32 configured profiles; this does not increase the
parallel execution limit.

## Reasoning and permissions

Yoke does not pass a nonexistent Qwen `--effort` flag. Configure model-specific
reasoning in the matching Qwen `modelProviders` entry's `generationConfig` using
Qwen's supported parameters. Qwen Code owns streaming, tool execution and replay
of `reasoning_content` between tool calls. Supported thinking controls differ by
model and endpoint; no identical thinking levels or benchmark quality is implied.

- `safe`: `--approval-mode auto-edit --sandbox --allowed-tools run_shell_command`.
  The explicit shell allowance enables headless test/build commands inside the
  required Qwen sandbox. It is not a command-by-command human approval flow.
  A working Qwen sandbox backend must be installed; Yoke never silently removes it.
- `read-only`: plan approval mode plus sandbox, without the shell allowance.
- `unsafe`: explicit `--yolo`, with no sandbox requested by Yoke.
- When Yoke owns worker slots, the Qwen `agent`/legacy `task`, `create_sub_session`,
  `team_create` and `send_message` tools are excluded. This controls native
  delegation tools, not arbitrary programs invoked from a permitted shell.
- `bare`, `reasoningEffort` and enabling native multi-agent execution remain
  explicitly unsupported selections for Qwen.

The RTK hook uses native `PreToolUse` denial plus a retry instruction for simple,
supported commands. Qwen's documented `updatedInput` is not consumed by the
0.23.0 execution path, so the hook does not claim transparent argument rewriting.
It never executes commands or grants permission. Existing RTK commands and complex
shell expressions are left alone; the generated context also supplies RTK guidance.
RTK must be installed in the execution environment, including the sandbox.
Re-running setup/retrofit removes only the obsolete Yoke `BeforeTool` entry,
preserves unrelated hooks and backs up the original settings.

## Validation and limits

Regression tests cover native result/text/structured-result envelopes, nested
results, failures, cumulative token/model statistics, safe invocation and native
worker exclusions, manual skill policy, host/project detection, automatic review
selection, hook migration, all-agent configuration and idempotent API setup.

Reproduce the manual transport check after building:

```sh
node scripts/qwen-contract-smoke.mjs /path/to/installed/qwen-code/cli-entry.js
```

A manual contract smoke test used the **real Qwen Code 0.23.0 CLI** against a local
synthetic OpenAI-compatible SSE server. Qwen, DeepSeek and Kimi model selections
completed a read-file tool roundtrip, preserved reasoning content in the subsequent
request and returned parseable results with cumulative token usage. This local
transport check used explicit unsafe mode only in a scratch fixture; it does not
validate a real provider account, model quality, billing, rate limits, Windows or
a production sandbox backend. No authenticated provider benchmark was performed.

## Primary references

- [Qwen headless output and permissions](https://qwenlm.github.io/qwen-code-docs/en/users/features/headless/)
- [Qwen model providers and generation configuration](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/model-providers/)
- [Qwen source](https://github.com/QwenLM/qwen-code): native output adapters,
  `toolHookTriggers.ts`, `coreToolScheduler.ts`, configuration and provider presets.
- [DeepSeek API models and endpoints](https://api-docs.deepseek.com/)
- [DeepSeek thinking tool calls](https://api-docs.deepseek.com/guides/thinking_mode/)
- [Kimi API models and endpoints](https://platform.kimi.ai/docs/overview)
