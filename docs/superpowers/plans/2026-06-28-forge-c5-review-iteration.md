# Forge — Baustein C5 (review-iteration with role separation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a story's tests pass, optionally run a second, independent agent pass in a **reviewer** role that must approve before the story is committed/marked done — enforcing implementer ≠ reviewer role separation (the last guardrail from safe-agentic-workflow).

**Architecture:** A `review` runner is an injectable `AgentRunner` (same type as the implementer runner) invoked with a distinct **review** prompt. `runLoop` gains an optional `review?: AgentRunner`; when present, after `verify` passes and before marking the story done, it runs the reviewer — a non-success verdict blocks the story (no commit, stays open). This applies in both the isolated and non-isolated paths. `run-command` builds a `makeReviewRunner(agent)` from `--review`/`--reviewer=<agent>`, with the readiness gate covering the reviewer agent too. Default: no review (opt-in, backward compatible). Baustein C5 — the final loop guardrail.

**Tech Stack:** Node.js (ESM), TypeScript, vitest. Extends C1–C4 `runner.ts`, `loop.ts`, `run-command.ts`, `cli.ts`.

**Builds on:** A+B1+B2+C1+C2+B3+C3+C4 on `main`. Modifies: `src/loop/runner.ts`, `src/loop/loop.ts`, `src/loop/run-command.ts`, `src/cli.ts`, `canon/loop/loop-spec.md`.

---

## File Structure

```
src/loop/
  runner.ts        # MODIFY: buildReviewPrompt + makeReviewRunner
  loop.ts          # MODIFY: LoopOptions.review?; review step after verify in both paths
  run-command.ts   # MODIFY: resolve review runner (--review/--reviewer) + reviewer readiness gate
cli.ts (src/cli.ts) # MODIFY: loop run parses --review and --reviewer=<agent>
canon/loop/loop-spec.md  # MODIFY: document the review step
tests/loop/
  runner.test.ts           # MODIFY: buildReviewPrompt content; makeReviewRunner is a function
  loop.test.ts             # MODIFY: review approve/reject cases (non-isolated + isolated)
  loop-cli.integration.test.ts  # MODIFY: review wiring + reviewer readiness refusal
```

---

### Task 1: Review prompt + review runner factory

**Files:**
- Modify: `src/loop/runner.ts`
- Test: `tests/loop/runner.test.ts` (extend)

- [ ] **Step 1: Add failing tests**

In `tests/loop/runner.test.ts`, extend the import and add a describe block:
```ts
import { buildClaudePrompt, claudeInvocation, agentInvocation, makeRunner, isAgentAvailable, buildReviewPrompt, makeReviewRunner } from '../../src/loop/runner.js'
```
Add:
```ts
describe('buildReviewPrompt', () => {
  it('frames a reviewer role distinct from the implementer and lists acceptance criteria', () => {
    const p = buildReviewPrompt(story)
    expect(p).toMatch(/review/i)
    expect(p).toMatch(/did NOT implement|independent reviewer/i)
    expect(p).toContain('returns 200 for valid creds')
  })

  it('instructs the reviewer to reject (non-zero exit) on blocking issues and not to modify files', () => {
    const p = buildReviewPrompt(story)
    expect(p).toMatch(/exit non-zero|reject/i)
    expect(p).toMatch(/do not modify|do not commit/i)
  })
})

describe('makeReviewRunner', () => {
  it('returns a callable AgentRunner', () => {
    expect(typeof makeReviewRunner('claude')).toBe('function')
  })
})
```
(`story` is the existing fixture at the top of the file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- loop/runner`
Expected: FAIL — `buildReviewPrompt`/`makeReviewRunner` not exported.

- [ ] **Step 3: Add to `src/loop/runner.ts`**

Add after `buildClaudePrompt`:
```ts
export function buildReviewPrompt(story: Story): string {
  const criteria = story.acceptance.map(a => `- ${a}`).join('\n')
  return [
    'You are an independent reviewer inside the Forge loop. You did NOT implement this change.',
    'Review the current uncommitted working-tree changes against the story below.',
    '',
    `Story ${story.id}: ${story.title}`,
    'Acceptance criteria:',
    criteria,
    '',
    'Approve by exiting 0 ONLY if every acceptance criterion is met and the change is sound.',
    'If you find ANY blocking issue (an unmet criterion, a bug, a missing test), exit non-zero to reject.',
    'Do not modify files. Do not commit.',
  ].join('\n')
}
```

Add after `makeRunner`:
```ts
export function makeReviewRunner(agent: Agent): AgentRunner {
  return (ctx: AgentContext): AgentResult => {
    const inv = agentInvocation(agent, buildReviewPrompt(ctx.story), ctx.targetDir)
    try {
      execFileSync(inv.command, inv.args, inv.options)
      return { success: true, summary: `${agent} approved ${ctx.story.id}` }
    } catch (e) {
      return { success: false, summary: `${agent} rejected ${ctx.story.id}: ${(e as Error).message}` }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- loop/runner`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/loop/runner.ts tests/loop/runner.test.ts
git commit -m "feat: add reviewer-role prompt and review runner factory"
```

---

### Task 2: Review step in runLoop (both paths)

**Files:**
- Modify: `src/loop/loop.ts`
- Test: `tests/loop/loop.test.ts` (extend)

- [ ] **Step 1: Add failing tests**

In `tests/loop/loop.test.ts`, add review stubs and cases. Near the other stubs:
```ts
const reviewOk: AgentRunner = () => ({ success: true, summary: 'approved' })
const reviewReject: AgentRunner = () => ({ success: false, summary: 'rejected: criterion unmet' })
```
Add to the main (non-isolated) `describe('runLoop', ...)`:
```ts
  it('blocks when the reviewer rejects after verify passes (no commit, story stays open)', () => {
    const commits: string[] = []
    const git: GitOps = { isClean: () => true, commitAll: (_d, m) => commits.push(m), addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} }
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git, verify: verifyOk, review: reviewReject, maxIterations: 10 })
    expect(res.status).toBe('blocked')
    expect(res.reason).toMatch(/rejected in review/i)
    expect(loadPrd(prd()).every(s => !s.passes)).toBe(true)
    expect(commits).toHaveLength(0)
  })

  it('completes when the reviewer approves', () => {
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git: cleanGit(), verify: verifyOk, review: reviewOk, maxIterations: 10 })
    expect(res.status).toBe('complete')
  })
```
And to the `describe('runLoop with isolation', ...)`:
```ts
  it('blocks in isolated mode when the reviewer rejects, leaving the main PRD untouched', () => {
    const removed: string[] = []
    const res = runLoop({
      prdPath: isoPrd(), targetDir: isoDir, runner: alwaysPass, git: fsWorktreeGit(isoDir, removed),
      verify: verifyOk, review: reviewReject, isolate: true, maxIterations: 5,
    })
    expect(res.status).toBe('blocked')
    expect(res.reason).toMatch(/rejected in review/i)
    expect(loadPrd(isoPrd())[0].passes).toBe(false)
    expect(removed.length).toBe(1) // worktree still cleaned up
  })
```
(The `cleanGit()` helper must already return the 5-method GitOps from C4; if it does not include the worktree no-ops, this test's `git` object literal above shows the required shape.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- loop/loop`
Expected: FAIL — `review` is not part of `LoopOptions`; no review step.

- [ ] **Step 3: Modify `src/loop/loop.ts`**

Add `review` to `LoopOptions`:
```ts
export interface LoopOptions {
  prdPath: string
  targetDir: string
  runner: AgentRunner
  git: GitOps
  verify: Verifier
  maxIterations: number
  isolate?: boolean
  review?: AgentRunner
}
```

**Isolated path** — after the verify check passes (the block that returns blocked on `!verdict.passed`) and before `const updated = stories.map(...)`, insert:
```ts
        if (opts.review) {
          const reviewResult = opts.review({ targetDir: wt, story })
          if (!reviewResult.success) {
            return { status: 'blocked', iterations, reason: `story ${story.id} rejected in review: ${reviewResult.summary}`, finalProgress: progress(stories) }
          }
        }
```

**Non-isolated path** — after the verify check passes (the block that returns blocked on `!verdict.passed`) and before the `try {` that marks/commits, insert:
```ts
    if (opts.review) {
      const reviewResult = opts.review({ targetDir: opts.targetDir, story })
      if (!reviewResult.success) {
        return {
          status: 'blocked',
          iterations,
          reason: `story ${story.id} rejected in review: ${reviewResult.summary}`,
          finalProgress: progress(stories),
        }
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- loop/loop`
Expected: PASS (existing + 3 new). Existing tests without `review` are unaffected (review is optional).

- [ ] **Step 5: Commit**

```bash
git add src/loop/loop.ts tests/loop/loop.test.ts
git commit -m "feat: require reviewer approval before completing a story"
```

---

### Task 3: Wire --review / --reviewer through run-command and CLI

**Files:**
- Modify: `src/loop/run-command.ts`, `src/cli.ts`
- Test: `tests/loop/loop-cli.integration.test.ts` (extend)

- [ ] **Step 1: Add failing tests**

In `tests/loop/loop-cli.integration.test.ts`, add cases. Add a review stub near the top:
```ts
const reviewReject: AgentRunner = () => ({ success: false, summary: 'nope' })
```
Add:
```ts
  it('blocks when an injected review runner rejects', () => {
    saveConfig(dir, { ...cfg(), verify: { command: 'node -e "process.exit(0)"' } })
    const code = runLoopCommand(dir, { maxIterations: 5, runner: passRunner, git: stubGit, verify: verifyOk, reviewRunner: reviewReject })
    expect(code).toBe(1)
    expect(loadPrd(join(dir, '.forge', 'prd.yaml'))[0].passes).toBe(false)
  })

  it('refuses to run when the reviewer agent CLI is unavailable', () => {
    saveConfig(dir, { ...cfg(), verify: { command: 'node -e "process.exit(0)"' } })
    const code = runLoopCommand(dir, {
      maxIterations: 5, runner: passRunner, git: stubGit, verify: verifyOk,
      reviewer: 'codex', isAvailable: (a) => a !== 'codex',
    })
    expect(code).toBe(2)
  })
```
(`AgentRunner` must be imported in this test file; add it to the existing `../../src/loop/runner.js` import if not present.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- loop-cli`
Expected: FAIL — `RunLoopCommandOptions` has no `reviewRunner`/`reviewer`.

- [ ] **Step 3: Modify `src/loop/run-command.ts`**

Update the runner import to include `makeReviewRunner`:
```ts
import { makeRunner, makeReviewRunner, isAgentAvailable, type AgentRunner } from './runner.js'
```

Extend `RunLoopCommandOptions`:
```ts
export interface RunLoopCommandOptions {
  maxIterations: number
  runner?: AgentRunner
  git?: GitOps
  verify?: Verifier
  agent?: Agent
  isAvailable?: (agent: Agent) => boolean
  isolate?: boolean
  reviewRunner?: AgentRunner
  reviewer?: Agent
  review?: boolean
}
```

In `runLoopCommand`, compute the resolved runner agent ONCE near the top of the function (after the `config`/PRD/verify checks, replacing the current `if (!runner) { const agent = ... }` shape) so both the runner and the reviewer can reuse it:
```ts
  const available = opts.isAvailable ?? isAgentAvailable
  const runnerAgent: Agent = opts.agent ?? config.agents[0] ?? 'claude'

  let runner = opts.runner
  if (!runner) {
    if (!available(runnerAgent)) {
      console.error(`Agent CLI "${runnerAgent}" was not found on PATH. Install it, or pick another with --runner=<claude|codex|gemini>.`)
      return 2
    }
    runner = makeRunner(runnerAgent)
  }

  let review = opts.reviewRunner
  if (!review && (opts.review || opts.reviewer)) {
    const reviewerAgent: Agent = opts.reviewer ?? runnerAgent
    if (!available(reviewerAgent)) {
      console.error(`Reviewer agent CLI "${reviewerAgent}" was not found on PATH. Install it, or pick another with --reviewer=<claude|codex|gemini>.`)
      return 2
    }
    review = makeReviewRunner(reviewerAgent)
  }
```
Pass `review` into the `runLoop` call (add the field):
```ts
  const result = runLoop({
    prdPath: path,
    targetDir,
    runner,
    git: opts.git ?? realGitOps,
    verify,
    maxIterations: opts.maxIterations,
    isolate: opts.isolate ?? false,
    review,
  })
```

- [ ] **Step 4: Modify `src/cli.ts` to parse `--review` / `--reviewer=`**

In the `loop` `run` branch, after parsing `agent` and `isolate`, add:
```ts
        const reviewerArg = rest.find(a => a.startsWith('--reviewer='))?.slice('--reviewer='.length)
        const valid = ['claude', 'codex', 'gemini']
        let reviewer: Agent | undefined
        if (reviewerArg) {
          if (!valid.includes(reviewerArg)) {
            console.error(`Invalid --reviewer value: ${reviewerArg} (expected claude|codex|gemini)`)
            return 1
          }
          reviewer = reviewerArg as Agent
        }
        const review = rest.includes('--review')
        return runLoopCommand(targetDir, { maxIterations: rawMax, agent, isolate, reviewer, review })
```
(Remove the previous `return runLoopCommand(...)` line in that branch so this is the single return.) Update the loop usage string:
```ts
      console.log('usage: forge loop <on|off|status|run [--max=N] [--runner=<claude|codex|gemini>] [--reviewer=<claude|codex|gemini>] [--review] [--isolate]> [targetDir]')
```

- [ ] **Step 5: Run suite + build**

Run: `npm test`
Expected: all pass.

Run: `npm run build`
Expected: tsc 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/loop/run-command.ts src/cli.ts tests/loop/loop-cli.integration.test.ts
git commit -m "feat: wire --review/--reviewer with reviewer readiness gate"
```

---

### Task 4: Update canon loop-spec

**Files:**
- Modify: `canon/loop/loop-spec.md`

- [ ] **Step 1: Document the review step**

In `canon/loop/loop-spec.md`, add a review note near the iteration steps:
```markdown
Pass `--review` (or `--reviewer=<claude|codex|gemini>` for a different agent) to add a role-separated review step: after the tests pass, an independent reviewer agent must approve the change before the story is committed and marked done. A rejection blocks the story (no commit). The reviewer is a fresh agent pass — the implementer never reviews its own work.
```
And replace the Limitations section with:
```markdown
## Limitations
- The loop verifies via the project's test command and an optional agent review; it has no formal merge-queue or multi-reviewer quorum.
```

- [ ] **Step 2: Validate the canon**

Run: `npm run forge -- validate canon`
Expected: `✓ canon valid (canon)`.

Run: `npm test -- real-canon`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add canon/loop/loop-spec.md
git commit -m "docs: canon loop-spec documents the role-separated review step"
```

---

## Self-Review

**1. Spec coverage (Baustein C5 scope):**
- Reviewer-role prompt distinct from implementer → Task 1 ✓
- Review runner (fresh agent pass) → Task 1 (`makeReviewRunner`) ✓
- Review step after verify, before commit, in BOTH loop paths → Task 2 ✓
- Reviewer rejection blocks the story (no commit, stays open) → Task 2 ✓
- Role separation: reviewer can be a different agent (`--reviewer=`) or a fresh pass of the same (`--review`) → Tasks 3 ✓
- Reviewer agent covered by the readiness gate → Task 3 ✓
- Opt-in, default off (existing tests unaffected) → Tasks 2, 3 ✓
- Deterministic tests (injected review runner; readiness via stub) → Tasks 2, 3 ✓

**2. Placeholder scan:** No TBD/TODO. Every step has complete code.

**3. Type consistency:** `buildReviewPrompt`, `makeReviewRunner`, `LoopOptions.review?: AgentRunner`, `RunLoopCommandOptions.reviewRunner?`/`reviewer?`/`review?`. The review runner reuses `AgentRunner`/`AgentContext`/`AgentResult` and `agentInvocation` from C3. `runnerAgent` is computed once and reused for both runner and reviewer resolution + readiness. The review step is inserted in both the isolated (targetDir = worktree) and non-isolated (targetDir = repo) paths, after verify and before mark/commit; all existing GitOps stubs already have the 5 methods from C4. ✓

## Next Plans (not this document)

- (C5 completes the planned loop guardrails. Possible future work: merge-queue / multi-reviewer quorum, a DEP0190 shell-handling cleanup, and a Serena code-graph swap option — all optional.)
