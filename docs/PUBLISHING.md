# Publishing channels — status & playbook

Where Yoke is published, and how each channel gets updated. (Researched 2026-07-10.)

## Live

| Channel | How | Update path |
|---|---|---|
| **npm** — [`@hecer/yoke`](https://www.npmjs.com/package/@hecer/yoke) | `npm publish` (2FA) | every release |
| **GitHub** — [HECer/yoke](https://github.com/HECer/yoke) | push + tag | every release |
| **Claude Code plugin (self-marketplace)** | `.claude-plugin/plugin.json` + `marketplace.json` in this repo; users: `/plugin marketplace add HECer/yoke` → `/plugin install yoke@yoke` | bump `version` in `plugin.json` |
| **Gemini CLI extension** | `gemini-extension.json` + `GEMINI-EXTENSION.md` at repo root; users: `gemini extensions install https://github.com/HECer/yoke` | bump `version` in the manifest |

## Submitted / pending

| Channel | How | Status |
|---|---|---|
| **Gemini extensions gallery** (geminicli.com/extensions) | automatic daily crawl: needs `gemini-extension.json` at repo root + `gemini-cli-extension` repo topic — both done | wait for crawler |
| **Anthropic community plugin directory** (`claude-community`, surfaced in `/plugin > Discover`) | form at **platform.claude.com/plugins/submit** (Console account, Developer role; submit the public repo URL; `claude plugin validate` runs in their pipeline — passes locally). After approval: pinned to a commit SHA, CI auto-bumps on push, catalog syncs nightly | **needs a human login** — see below |

### Anthropic directory submission (manual step)

1. Log in at https://platform.claude.com (free Console account is enough; role Developer+).
2. Open https://platform.claude.com/plugins/submit
3. Submit the public repo: `https://github.com/HECer/yoke`
4. Suggested description: *"Cross-agent coding harness: one curated skill canon (TDD,
   brainstorming → spec → plan, systematic debugging, cross-model review, design
   verification) plus mechanical safety gates and an autonomous loop via the yoke CLI."*
5. Category: development. Plugin name (immutable): `yoke`.

## Worth doing later (community lists, PR/issue-based)

- **awesome-claude-code** (hesreallyhim) — issue-form only, explicitly human-submitted, no PRs.
- **ComposioHQ/awesome-claude-plugins** — PR per template (high merge latency).
- **davila7/claude-code-templates** (aitmpl.com) — PR per CONTRIBUTING.md.
- **Codex plugin directory** (platform.openai.com/plugins) — requires verified developer
  identity + test cases; medium-high effort. Codex CLI users can already consume the repo
  marketplace directly.
- Auto-crawled directories (crossaitools.com etc.) pick the repo up on their own once the
  marketplace manifest exists.
- Launch channels (Product Hunt, Show HN, r/ClaudeAI, r/ClaudeCode) — deliberate, human-led.
