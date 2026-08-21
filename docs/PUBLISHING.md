# Publishing channels — status & playbook

Where Yoke is published, and how each channel gets updated. (Reviewed 2026-08-20.)

## Live

| Channel | How | Update path |
|---|---|---|
| **npm** — [`@hecer/yoke`](https://www.npmjs.com/package/@hecer/yoke) | GitHub OIDC trusted publishing | every release |
| **GitHub** — [HECer/yoke](https://github.com/HECer/yoke) | push + tag + GitHub Release | every release |
| **Claude Code plugin (self-marketplace)** | `.claude-plugin/plugin.json` + `marketplace.json` in this repo; users: `/plugin marketplace add HECer/yoke` → `/plugin install yoke@yoke` | bump `version` in `plugin.json` |
| **Gemini CLI extension** | `gemini-extension.json` + `GEMINI-EXTENSION.md` at repo root; users: `gemini extensions install https://github.com/HECer/yoke` | bump `version` in the manifest |
| **Codex project skills** | `npx @hecer/yoke setup .` writes the canon to `.agents/skills/` plus native Codex config/hooks; `.codex-plugin/plugin.json` is bundled for plugin-capable hosts | every npm release |

## GitHub release (required, not just a tag)

Before the release commit, update every user-facing version and README statistic, then require the
same checks npm will run:

```bash
npm run docs:update
npm run docs:check
npm run prepublishOnly
```

`docs:update` synchronizes the README's package version, test count, skill count, and supported
agents from `package.json`, Vitest discovery, and `canon/manifest.yaml`. The version must also be
kept in sync in `package-lock.json`, `canon/manifest.yaml`, `.claude-plugin/plugin.json`,
`.codex-plugin/plugin.json`, and `gemini-extension.json`.

A pushed tag appears under **Tags**, but GitHub only shows an entry under **Releases** after a
release object is created. Use this idempotent check after the version commit reaches `main`:

```bash
set -euo pipefail
VERSION=1.6.1
TARGET=$(git rev-parse HEAD)
git fetch --tags origin

REMOTE=$(git ls-remote origin "refs/tags/v$VERSION^{}" | awk 'NR == 1 { print $1 }')
if [ -z "$REMOTE" ]; then
  REMOTE=$(git ls-remote origin "refs/tags/v$VERSION" | awk 'NR == 1 { print $1 }')
fi
if [ -n "$REMOTE" ] && [ "$REMOTE" != "$TARGET" ]; then
  echo "origin/v$VERSION already points at a different commit" >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null; then
  test "$(git rev-list -n 1 "v$VERSION")" = "$TARGET" || {
    echo "v$VERSION already points at a different commit" >&2
    exit 1
  }
else
  git tag "v$VERSION"
fi
git push origin "refs/tags/v$VERSION"
gh release view "v$VERSION" >/dev/null 2>&1 || \
  gh release create "v$VERSION" --title "Yoke $VERSION" --generate-notes
```

Verify both surfaces before publishing npm: `gh release view "v$VERSION"` and
`npm view @hecer/yoke version`.

## npm trusted publishing

The `publish-npm.yml` workflow publishes a stable package automatically when a GitHub Release is
published. It checks out that exact tag, requires the tag to match the version in `package.json`,
reruns `prepublishOnly` through `npm publish`, and skips a version that already exists. GitHub OIDC
provides a short-lived publishing identity; no `NPM_TOKEN` repository secret is used. npm adds
provenance automatically for this public repository.

One package-owner setup step is required on npmjs.com under the `@hecer/yoke` package settings:

- Publisher: GitHub Actions
- Organization or user: `HECer`
- Repository: `yoke`
- Workflow filename: `publish-npm.yml`
- Environment: leave empty
- Allowed action: `npm publish`

After the trusted publisher exists, the next GitHub Release publishes automatically. To publish an
already-created release such as `v1.6.1`, run the **Publish npm** workflow manually and provide that
existing tag. The workflow refuses tags without a published GitHub Release and refuses tag/version
mismatches. After the first successful OIDC publish, disable traditional token publishing and revoke
obsolete automation tokens in npm package settings.

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
- **Codex plugin directory** — public directory submission remains a separate channel. Codex
  users do not need it: the npm setup path installs native project skills deterministically.
- Auto-crawled directories (crossaitools.com etc.) pick the repo up on their own once the
  marketplace manifest exists.
- Launch channels (Product Hunt, Show HN, r/ClaudeAI, r/ClaudeCode) — deliberate, human-led.
