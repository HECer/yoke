# OpenCode, Kilo and Pi

Yoke 1.13.0 adds first-class adapters for OpenCode, Kilo and Pi coding agent. The adapters share Yoke's invocation, routing, review, quality, telemetry and retrofit contracts, while preserving the controls each harness actually provides.

This is a CLI integration, not an authentication bundle. Install the selected harness, log in or configure its API provider, and verify it independently before starting a Yoke loop.

## Setup and retrofit

Select one of the new harnesses explicitly:

```sh
yoke setup . --yes --agent=opencode --runner=opencode
yoke setup . --yes --agent=kilo --runner=kilo
yoke setup . --yes --agent=pi --runner=pi
```

To add one to an existing project without changing the other generated artifacts:

```sh
yoke retrofit . --agent=opencode
yoke retrofit . --agent=kilo
yoke retrofit . --agent=pi
```

`--agent=all` now includes all seven supported harnesses. Retrofit is merge-aware for the native config files and backs up Yoke-managed overwrites under `.yoke/backup/`.

## Native artifacts

| Harness | Generated project artifacts | Native capabilities used by Yoke |
|---|---|---|
| OpenCode | `AGENTS.md`, `.opencode/skills/`, `opencode.json`, `.opencode/agents/yoke-reviewer.md` | `run --format json`, provider/model selection, variants, plan agent, local MCP servers |
| Kilo | `AGENTS.md`, `.kilo/skills/`, `kilo.jsonc`, `.kilo/agents/yoke-reviewer.md` | OpenCode-compatible `run --format json`, provider/model selection, variants, plan agent, local MCP servers |
| Pi | `AGENTS.md`, `.pi/skills/`, `.pi/settings.json` | JSONL mode, provider/model selection, thinking level, explicit tool allowlists |

All three consume the shared `AGENTS.md` and `.yoke/context/*.md` context. OpenCode and Kilo also receive the configured local MCP servers from the Yoke code-graph choice. Pi has no native MCP or sub-agent layer, so its integration intentionally uses the portable skills and Yoke's own loop rather than pretending those features exist.

## Provider, model and variant selection

Yoke keeps the harness (`agent`) separate from the model provider (`provider`) and model identifier (`model`):

```yaml
runner:
  agent: opencode
  provider: openrouter
  model: openai/gpt-5.6
  variant: high
```

For OpenCode and Kilo this becomes `--model openrouter/openai/gpt-5.6 --variant high`. If no explicit provider is configured, a model string already in the harness's `provider/model` form is passed through unchanged. For Pi the equivalent is:

```yaml
runner:
  agent: pi
  provider: openai
  model: gpt-5.6
  reasoningEffort: high
```

This becomes `--provider openai --model gpt-5.6 --thinking high`. Pi calls `variant` and `reasoningEffort` the same underlying thinking-level selection; configuring both with different values is rejected.

The same fields are available on routing workers and quality critic/repair roles. Routing evidence is keyed by harness, provider, model, reasoning effort and variant, so a model profile does not inherit another profile's success history.

## Permission profiles and honest limits

| Yoke profile | OpenCode / Kilo | Pi |
|---|---|---|
| `safe` | Headless `--auto` run; Yoke still verifies the resulting tree and gates the commit | `read,bash,edit,write` tool allowlist so the implementer can test and modify the project |
| `read-only` | `--agent plan` plus JSON output | `read,grep,find,ls` only |
| `unsafe` | Explicit `--dangerously-skip-permissions` | Harness default tool set; no Yoke-added allowlist |

OpenCode, Kilo and Pi do not provide the same OS-level sandbox boundary as Codex or Gemini. The Yoke `safe` label therefore describes the selected harness controls and Yoke's mechanical gates, not a universal filesystem sandbox. Use `read-only` for review and do not use `unsafe` unless the project owner accepts the boundary.

The Yoke loop disables native delegation where the harness exposes it, so Yoke's worker budget remains the authority. OpenCode and Kilo native agents are installed as a read-only reviewer artifact; Yoke's review runner still validates the structured verdict itself. Pi has no native sub-agent or plan mode by design.

## Telemetry and validation limits

Yoke parses OpenCode/Kilo JSON text events and `step_finish` token/cost events, and Pi `message_end` plus `message_update.usage` events. Missing provider events produce partial or unknown measurements; they are never reported as zero-cost success. Provider-reported model and usage remain provider claims.

The release test suite covers argument construction, provider/variant propagation, routing and quality configuration, retrofit plans, host detection, JSON result parsing, and representative telemetry fixtures. It does not authenticate against every provider or claim equal model quality. Run a small project-specific smoke task after installing a harness and configuring credentials.

Official CLI references: [OpenCode CLI](https://dev.opencode.ai/docs/cli), [OpenCode configuration](https://opencode.ai/docs/config), [OpenCode skills](https://opencode.ai/docs/skills), [Kilo CLI reference](https://github.com/Kilo-Org/kilocode/blob/main/packages/kilo-docs/pages/code-with-ai/platforms/cli-reference.md), and [Pi coding agent](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md).
