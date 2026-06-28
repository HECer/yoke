# Contributing to Yoke

Thanks for your interest! Yoke is a small, test-first TypeScript project. This guide gets you productive quickly.

## Setup

```bash
npm install
npm test          # vitest — should be all green
npm run build     # tsc, no emit errors
npm run yoke -- validate canon
```

Requires Node ≥ 20 and git. No global install needed — run the CLI via `npm run yoke -- <command>`.

## How Yoke is structured

```
canon/            # the source of truth — harness-agnostic skills, policy, loop spec, tool wiring
src/
  canon/          # manifest schema + validator
  retrofit/       # detect · plan · apply · per-agent planners · tool wiring
  loop/           # prd · gates · runner · verify · git/worktree · loop · run-command
docs/superpowers/ # the design spec and every component's implementation plan
tests/            # vitest, mirrors src/
```

The **canon** is the single source of truth. The **retrofit** layer generates idiomatic artifacts per agent. The **loop** layer is the optional autonomous runner. Everything is wired through injectable seams (runner, git, verify, review) so it stays deterministic and testable without invoking real agents.

## Working style

Yoke was built test-first, and contributions should follow the same rhythm:

1. **Write a failing test** for the behavior you want.
2. **Make it pass** with the simplest change (see the `minimal-code` skill — it applies to us too).
3. **Keep the suite green** (`npm test`) and the build clean (`npm run build`).
4. **One behavior per commit**, with a clear message.

### Adding a skill to the canon

1. Create `canon/skills/<id>/SKILL.md` with valid frontmatter (`name`, `description`).
2. Add it to `canon/manifest.yaml` under `skills:`.
3. Run `npm run yoke -- validate canon` — it must stay valid.

The existing planners propagate any canon skill to all three agents automatically, so no per-agent code change is needed.

### Adding a tool / MCP server

Wire it in `src/retrofit/tools.ts` and document it under `canon/tools/`. Keep launch commands as clearly-labelled, adjustable best-effort templates.

## Tests

- Use real temp-dir fixtures over mocks for filesystem behavior.
- Inject the runner / git / verify / review seams; never spawn a real agent CLI in tests.
- Cross-platform matters — CI runs on Linux **and** Windows.

## Pull requests

- Keep PRs focused; describe what changed and why.
- Ensure `npm test` and `npm run build` pass (CI checks both on Linux and Windows).
- Update the relevant docs (`README.md`, `canon/`, or `docs/superpowers/`) when behavior changes.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
