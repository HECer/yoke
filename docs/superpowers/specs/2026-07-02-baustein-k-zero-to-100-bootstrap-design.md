# Baustein K — Zero-to-100 Bootstrap: `yoke new`, PRD draft/check, loop cleanup, loop lock

Date: 2026-07-02
Status: approved (design delegated by user; scope approved in conversation: "ok setze es um wie du es geplant hast, gleich nach K")

## Problem

Yoke's core claim is "zero to 100% autonomous development", but today the zero side is missing:
the loop requires a hand-written `.yoke/prd.yaml` in an already-existing git repo. Greenfield
start is undocumented agent work. Two robustness gaps compound this: a crashed loop leaves
orphaned worktrees behind (manual `git worktree remove`), and two concurrent `yoke loop run`
invocations race on the PRD and status files.

## Goal

One command from idea to loop-ready project, plus loop robustness:

```
yoke new my-app --idea="CLI tool that ..."   # scaffold + retrofit + context + drafted PRD, committed
yoke loop on my-app && yoke loop run my-app --isolate
```

## Part 1: `yoke new <dir> [--idea="..."] [--agent=...] [--runner=<agent>] [--loop]`

Module: `src/new/command.ts`, export `runNew(dir: string, opts: RunNewOptions): number`.

Behavior, in order:

1. `<dir>` is required (usage + exit 1 if missing). If the directory exists **and is non-empty**,
   refuse with exit 1 (`yoke new` is greenfield-only; retrofit exists for brownfield). An existing
   empty directory is fine.
2. Create the directory (recursive) and `git init` it.
3. Minimal scaffold (language-agnostic — the PRD's first story scaffolds the real project):
   - `README.md`: `# <basename>` plus the idea text as a paragraph when `--idea` is given.
   - `.gitignore`: `node_modules/`, `dist/`, `.env` (one per line).
4. Run the existing retrofit (`runRetrofit(dir, { loop: opts.loop, agents })`). Agents resolve like
   the `retrofit` CLI case: `--agent=` list or default; in an empty dir detection finds nothing, so
   the default is `['claude']`.
5. Run `runContextInit(dir)`. When `--idea` is given, append `\n## Idea\n\n<idea>\n` to
   `.yoke/context/PROJECT.md` so every loop iteration sees the north star.
6. Write the PRD **template** to `.yoke/prd.yaml` (see Part 2a below): an empty story array `[]`
   preceded by comment lines showing a fully-formed example story. Comments survive because we
   write the file verbatim; `loadPrd` still parses it (empty array is schema-valid).
7. Initial commit: `git add -A` + commit `chore: bootstrap <basename> with yoke`
   (`-c commit.gpgsign=false`, same as `realGitOps.commitAll`). This makes `--isolate` work from
   iteration 1 (worktrees check out committed HEAD).
8. When `--idea` is given: run the PRD draft (Part 2) with `--runner` resolution, then commit the
   drafted PRD as a second commit `docs: draft PRD from idea`. If the draft fails (agent error or
   invalid YAML), keep the template, print
   `PRD draft failed (<reason>). Project is ready; retry with: yoke prd draft <dir> --idea="..."`
   and return **1** (the scaffold succeeded, but the user's idea→PRD ask did not — signal it).
9. Print next steps: edit/inspect `.yoke/prd.yaml`, set `verify.command` in `.yoke/config.yaml`,
   `yoke loop on <dir>`, `yoke loop run <dir> --isolate`.

Exit codes: 0 success; 1 usage / non-empty dir / draft failure; 2 requested draft agent unavailable.

Injectable seams for tests: `git?: (args: string[], cwd: string) => void` (default execFileSync
wrapper) and the Part-2 seams passed through (`isAvailable`, `run`).

## Part 2: `yoke prd draft [dir] --idea="..." [--runner=<agent>] [--force] [--timeout=<minutes>]`

Module: `src/prd/command.ts`, export `runPrdDraft(targetDir: string, opts: PrdDraftOptions): number`.

- `--idea` is required (exit 1 with usage if missing/empty).
- Overwrite guard: if `.yoke/prd.yaml` exists and parses to **> 0 stories**, refuse with exit 1
  (`PRD already has N stories — use --force to overwrite`) unless `--force`. The Part-1 template
  (0 stories) never triggers the guard.
- Agent resolution mirrors the loop: `--runner` ?? `config.agents[0]` ?? `'claude'`; must pass
  `isAgentAvailable`, else exit 2 with install hint. (No cross-model preference here — drafting is
  not adversarial review.)
- Prompt builder `buildPrdDraftPrompt(idea: string): string` in `src/prd/command.ts`:
  - You are drafting a PRD for the Yoke loop.
  - Break the idea into 5–12 small, independently shippable stories; each must fit one loop
    iteration.
  - Each story: `id` (STORY-1…), `title` (imperative), `priority` (dense from 1, lower = first),
    `acceptance` (2–5 testable, behavioral criteria — outcomes, not implementation), `passes: false`.
  - If the project has no source code yet, STORY-1 must scaffold the project skeleton including a
    runnable test suite, and its acceptance must include that the verify command
    (`.yoke/config.yaml` → `verify.command`) runs green.
  - Write ONLY the file `.yoke/prd.yaml` as a YAML array matching this schema (schema inlined).
    Do not modify other files. Do not commit.
- Execution reuses the Baustein-J plumbing: `agentInvocation` → default runner
  `runAgent(buildWatchdogInvocation(inv, idleMs))` with `resolveIdleMs(opts.timeoutMinutes, undefined)`;
  injectable `isAvailable` / `run` seams exactly like `src/review/command.ts`.
- Post-validation: `loadPrd(prdPath)` — on parse/schema failure exit 1 with the zod message; on
  success print `Drafted N stories → .yoke/prd.yaml` and exit 0. 0 drafted stories is a failure
  (exit 1, `agent produced an empty PRD`).

### Part 2a: PRD template

Exported const `PRD_TEMPLATE` (in `src/prd/command.ts`), written by `yoke new`:

```yaml
# Yoke PRD — the loop picks the lowest-priority open story each iteration.
# Story format (see canon/loop/prd.schema.md):
# - id: STORY-1
#   title: scaffold the project with a runnable test suite
#   priority: 1
#   acceptance:
#     - "the verify command exits 0"
#     - "a placeholder test exists and passes"
#   passes: false
[]
```

## Part 3: `yoke prd check [dir]`

Same module, export `runPrdCheck(targetDir: string): number`.

- Missing file → exit 1 (`No PRD at .yoke/prd.yaml — run yoke prd draft or yoke new`).
- Schema violation (zod) → print message, exit 1.
- Lints beyond the schema, each an error (exit 1): duplicate story ids; any story with an **empty
  `acceptance` array** (the schema allows `[]`, but the loop's stop-the-line gate will block it —
  fail fast here); zero stories (`PRD has no stories`).
- Success: print `✓ PRD valid — N stories, M pass` and exit 0. Chainable pre-loop gate.

## Part 4: `yoke loop cleanup [dir]`

Module: `src/loop/cleanup.ts`, export `runLoopCleanup(targetDir: string, opts?): number`.

- Scans `.yoke/worktrees/` only (yoke-created paths; never touches user worktrees). Missing/empty
  → `Nothing to clean.`, exit 0.
- For each entry: `git worktree remove --force <path>` from the repo root; collect failures and
  fall through. Afterwards run `git worktree prune`.
- Also removes a **stale** `.yoke/loop.lock` (holder pid not alive — see Part 5). A live lock is
  reported and left alone.
- Report `Removed N worktree(s).` (+ failures). Exit 0 when everything cleaned, 1 if any removal
  failed.
- Injectable seam: `git?: (args: string[], cwd: string) => void`.
- Registered under the existing `loop` CLI case as sub-command `cleanup`.

## Part 5: Loop lock (single-flight guard)

Module: `src/loop/lock.ts`:

- `lockPath(targetDir)` → `.yoke/loop.lock`; contents JSON `{ "pid": number, "startedAt": ISO }`.
- `isPidAlive(pid: number): boolean` — `process.kill(pid, 0)` in try/catch (works on Windows);
  `EPERM` counts as alive.
- `acquireLock(targetDir, pid?): { acquired: boolean; holderPid?: number }` — no file or unreadable/
  corrupt file → take it (mkdir `.yoke` if needed); holder alive → `{ acquired: false, holderPid }`;
  holder dead → warn-and-take (caller prints the warning; the function returns
  `{ acquired: true, stalePid }` — include `stalePid?: number` in the result).
- `releaseLock(targetDir)` — best-effort unlink, never throws.

Wiring in `runLoopCommand` (src/loop/run-command.ts): after the existing pre-checks (loop enabled,
PRD exists, verify resolved, agent available) and before `runLoop`, acquire the lock; on
`acquired: false` print
`Another loop is already running (pid <holderPid>). If that is wrong, run: yoke loop cleanup` and
return 2. On stale takeover print a warning. Release in `finally`.

Gitignore: add `.yoke/loop.lock` to `YOKE_IGNORE_LINES` (src/retrofit/gitignore.ts) so the
pre-dispatch clean-tree gate is not broken by the lock file itself. Note: `ensureGitignore` is
idempotent and appends only missing lines, so existing retrofitted projects pick the new line up
on their next retrofit.

## Part 6: Canon skill `authoring-prd`

`canon/skills/authoring-prd/SKILL.md` (kind: methodology), registered in `canon/manifest.yaml`.
Content: how to slice a product idea into loop-ready stories — small and independently shippable
(one loop iteration each); acceptance criteria are testable behavioral outcomes, never
implementation steps; dense priorities; greenfield STORY-1 scaffolds project + test runner and
wires `verify.command`; full `prd.yaml` example. This gives interactive sessions (all three
agents, via retrofit) the same discipline `yoke prd draft` encodes.

Canon count moves 26 → 27; the real-canon test that asserts the skill count must be updated.

## CLI usage line

`yoke new <dir> [--idea="..."] [--agent=...] [--runner=<agent>] [--loop] | prd <draft|check> [dir] [--idea="..."] [--runner=<agent>] [--force] | loop <on|off|status|run|cleanup> | ...`

## Testing

- `tests/prd/command.test.ts`: draft — runner receives resolved agent invocation (seam), `--runner`
  honored, unavailable → 2, overwrite guard (>0 stories blocks, `--force` passes, template `[]`
  passes), post-validation failure → 1, empty result → 1, success prints count; prompt builder —
  contains idea, schema, story-count band, STORY-1 scaffold rule, "Write ONLY"; check — valid PRD
  0, duplicate ids 1, empty acceptance 1, no stories 1, missing file 1.
- `tests/new/command.test.ts`: non-empty dir refused; scaffold files + git init + initial commit
  (seam-recorded git calls); retrofit artifacts present (real canon); PROJECT.md gets idea section;
  template PRD written and schema-parses to `[]`; `--idea` triggers draft via injected run seam and
  second commit; draft failure → exit 1 + template intact.
- `tests/loop/cleanup.test.ts`: removes listed worktrees via git seam + prune called; nothing to
  clean; failure → exit 1; stale lock removed, live lock kept.
- `tests/loop/lock.test.ts`: acquire on empty; blocked by live pid (use `process.pid`); stale
  takeover (dead pid, e.g. a just-exited child or an absurd pid); corrupt file → take; release
  best-effort; `runLoopCommand` returns 2 when locked (existing run-command tests gain one case,
  using the real lock with `process.pid`).
- `tests/retrofit/gitignore.test.ts`: extend for `.yoke/loop.lock`.
- Real-canon tests: 27 skills, `authoring-prd` frontmatter valid.

## Non-goals

- No language/framework project templates (STORY-1 scaffolds; keeps `yoke new` universal).
- No parallel loop, no CI triggers, no PRD estimation/dependencies.
- No cross-model preference for drafting (that's review's job).

## Attribution

PRD-driven Ralph loop: Geoffrey Huntley's Ralph technique; story-slicing discipline informed by
superpowers `writing-plans`. No external code.
