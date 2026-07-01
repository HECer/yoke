# Baustein J — Cross-Model Review + gstack Compose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone `yoke review` command that has a *second* model review the current diff as a pass/fail gate, and make `yoke retrofit` compose with gstack (Claude-only routing note) when it is installed.

**Architecture:** Reuse the loop's existing agent-invocation + watchdog plumbing (`src/loop/runner.ts`) behind a new exported `runAgent`, and a new story-less prompt builder. A new `src/review/command.ts` (mirroring `src/context/command.ts`) resolves the reviewer, builds the scope + prompt, invokes, and maps the result to an exit code. gstack detection is a small pure module threaded into the Claude planner only.

**Tech Stack:** Node.js/TypeScript (ESM, `.js` import specifiers), vitest, existing `agentInvocation`/`buildWatchdogInvocation`/`resolveIdleMs` helpers.

---

## File Structure

- Create: `src/retrofit/gstack.ts` — `detectGstack(targetDir, homedir?)` pure detection.
- Create: `src/review/command.ts` — `runReview(targetDir, opts): number` (reviewer resolution, scope, invoke, exit code).
- Create: `tests/retrofit/gstack.test.ts`, `tests/review/command.test.ts`.
- Modify: `src/loop/runner.ts` — add `buildStandaloneReviewPrompt`, export `runAgent`.
- Modify: `src/retrofit/planners/claude.ts` — append a "Composed tools" section to CLAUDE.md when gstack detected.
- Modify: `src/cli.ts` — add `case 'review'` + usage string.
- Modify: `canon/skills/review/SKILL.md`, `canon/skills/ATTRIBUTION.md`, `README.md`.

---

### Task 1: `buildStandaloneReviewPrompt` + `runAgent` export

**Files:**
- Modify: `src/loop/runner.ts` (add after `buildReviewPrompt`, and after `runCli`)
- Test: `tests/loop/standalone-review.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/loop/standalone-review.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildStandaloneReviewPrompt } from '../../src/loop/runner.js'

describe('buildStandaloneReviewPrompt', () => {
  it('names the scope and forbids file changes', () => {
    const p = buildStandaloneReviewPrompt('the uncommitted working-tree changes')
    expect(p).toContain('the uncommitted working-tree changes')
    expect(p).toMatch(/independent reviewer/i)
    expect(p).toMatch(/exit(ing)? 0/i)
    expect(p).toMatch(/do not modify files/i)
  })
  it('injects an optional focus line', () => {
    const p = buildStandaloneReviewPrompt('the diff main..HEAD', 'authentication and access control')
    expect(p).toContain('the diff main..HEAD')
    expect(p).toContain('authentication and access control')
  })
  it('omits the focus line when no focus is given', () => {
    expect(buildStandaloneReviewPrompt('x')).not.toMatch(/Pay particular attention/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/loop/standalone-review.test.ts`
Expected: FAIL — `buildStandaloneReviewPrompt` is not exported.

- [ ] **Step 3: Implement in `src/loop/runner.ts`**

Add after `buildReviewPrompt` (around line 60):

```ts
export function buildStandaloneReviewPrompt(scope: string, focus?: string): string {
  const lines = [
    'You are an independent reviewer. You did NOT write this change.',
    `Review ${scope}. Run git yourself to see the diff (e.g. \`git diff\`, or \`git diff <base>..HEAD\`).`,
    'Judge it for correctness, unmet intent, missing tests, and obvious bug or security risks.',
  ]
  if (focus) lines.push(`Pay particular attention to: ${focus}.`)
  lines.push(
    '',
    'Approve by exiting 0 ONLY if the change is sound and complete.',
    'If you find ANY blocking issue, exit non-zero to reject and explain what is wrong.',
    'Do not modify files. Do not commit.',
  )
  return lines.join('\n')
}
```

Add after `runCli` (around line 129), exporting a reusable runner:

```ts
// Reusable one-shot invocation runner for callers outside the loop (e.g. `yoke review`).
// Mirrors makeRunner's try/catch: success=true when the CLI exits 0, false when it throws.
export function runAgent(inv: Invocation): AgentResult {
  try {
    runCli(inv)
    return { success: true, summary: 'exited 0' }
  } catch (e) {
    return { success: false, summary: (e as Error).message }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/loop/standalone-review.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/loop/runner.ts tests/loop/standalone-review.test.ts
git commit -m "feat(review): standalone review prompt + reusable runAgent"
```

---

### Task 2: `detectGstack`

**Files:**
- Create: `src/retrofit/gstack.ts`
- Test: `tests/retrofit/gstack.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/retrofit/gstack.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectGstack } from '../../src/retrofit/gstack.js'

describe('detectGstack', () => {
  let target: string
  let home: string
  beforeEach(() => {
    target = mkdtempSync(join(tmpdir(), 'yoke-gs-t-'))
    home = mkdtempSync(join(tmpdir(), 'yoke-gs-h-'))
  })
  afterEach(() => {
    rmSync(target, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  it('is false when gstack is not installed anywhere', () => {
    expect(detectGstack(target, home)).toBe(false)
  })
  it('detects a repo-local gstack skill dir', () => {
    mkdirSync(join(target, '.claude', 'skills', 'gstack'), { recursive: true })
    expect(detectGstack(target, home)).toBe(true)
  })
  it('detects a global (home) gstack skill dir', () => {
    mkdirSync(join(home, '.claude', 'skills', 'gstack'), { recursive: true })
    expect(detectGstack(target, home)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/retrofit/gstack.test.ts`
Expected: FAIL — module `src/retrofit/gstack.ts` not found.

- [ ] **Step 3: Implement `src/retrofit/gstack.ts`**

```ts
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// Best-effort, non-fatal detection of a gstack install (garrytan/gstack).
// gstack lives at ~/.claude/skills/gstack (global) or .claude/skills/gstack (repo-local).
export function detectGstack(targetDir: string, home: string = homedir()): boolean {
  const candidates = [
    join(targetDir, '.claude', 'skills', 'gstack'),
    join(home, '.claude', 'skills', 'gstack'),
  ]
  return candidates.some(p => {
    try { return existsSync(p) } catch { return false }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/retrofit/gstack.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/retrofit/gstack.ts tests/retrofit/gstack.test.ts
git commit -m "feat(retrofit): detectGstack (best-effort, repo-local + global)"
```

---

### Task 3: `runReview` command

**Files:**
- Create: `src/review/command.ts`
- Test: `tests/review/command.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/review/command.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { runReview } from '../../src/review/command.js'
import type { Invocation } from '../../src/loop/runner.js'
import type { Agent } from '../../src/retrofit/config.js'

function harness(overrides: {
  available?: Agent[]
  succeed?: boolean
} = {}) {
  const available = new Set(overrides.available ?? ['codex', 'gemini', 'claude'])
  const calls: Invocation[] = []
  const run = (inv: Invocation) => {
    calls.push(inv)
    return { success: overrides.succeed ?? true, summary: overrides.succeed === false ? 'nope' : 'exited 0' }
  }
  const isAvailable = (a: Agent) => available.has(a)
  return { calls, run, isAvailable }
}

describe('runReview', () => {
  it('prefers a second model (codex) and approves with exit 0', () => {
    const h = harness()
    const code = runReview('.', { run: h.run, isAvailable: h.isAvailable })
    expect(code).toBe(0)
    expect(h.calls[0].command).toBe('codex')
    expect(h.calls[0].input).toContain('uncommitted working-tree changes')
  })
  it('falls through codex -> gemini when codex is absent', () => {
    const h = harness({ available: ['gemini', 'claude'] })
    runReview('.', { run: h.run, isAvailable: h.isAvailable })
    expect(h.calls[0].command).toBe('gemini')
  })
  it('falls back to claude self-review when it is the only agent', () => {
    const h = harness({ available: ['claude'] })
    const code = runReview('.', { run: h.run, isAvailable: h.isAvailable })
    expect(code).toBe(0)
    expect(h.calls[0].command).toBe('claude')
  })
  it('errors (exit 2) when no agent CLI is available', () => {
    const h = harness({ available: [] })
    expect(runReview('.', { run: h.run, isAvailable: h.isAvailable })).toBe(2)
    expect(h.calls).toHaveLength(0)
  })
  it('honours an explicit --reviewer', () => {
    const h = harness()
    runReview('.', { reviewer: 'gemini', run: h.run, isAvailable: h.isAvailable })
    expect(h.calls[0].command).toBe('gemini')
  })
  it('errors (exit 2) when the explicit reviewer is unavailable', () => {
    const h = harness({ available: ['claude'] })
    expect(runReview('.', { reviewer: 'codex', run: h.run, isAvailable: h.isAvailable })).toBe(2)
  })
  it('rejects with exit 1 when the reviewer finds issues', () => {
    const h = harness({ succeed: false })
    expect(runReview('.', { run: h.run, isAvailable: h.isAvailable })).toBe(1)
  })
  it('builds a base-range scope with --base', () => {
    const h = harness()
    runReview('.', { base: 'main', run: h.run, isAvailable: h.isAvailable })
    expect(h.calls[0].input).toContain('main..HEAD')
  })
  it('injects --focus into the prompt', () => {
    const h = harness()
    runReview('.', { focus: 'the auth layer', run: h.run, isAvailable: h.isAvailable })
    expect(h.calls[0].input).toContain('the auth layer')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/review/command.test.ts`
Expected: FAIL — module `src/review/command.ts` not found.

- [ ] **Step 3: Implement `src/review/command.ts`**

```ts
import type { Agent } from '../retrofit/config.js'
import {
  agentInvocation,
  buildStandaloneReviewPrompt,
  buildWatchdogInvocation,
  runAgent,
  isAgentAvailable,
  type Invocation,
  type AgentResult,
} from '../loop/runner.js'
import { resolveIdleMs } from '../loop/run-command.js'

export interface RunReviewOptions {
  reviewer?: Agent
  base?: string
  focus?: string
  timeoutMinutes?: number
  isAvailable?: (a: Agent) => boolean
  run?: (inv: Invocation) => AgentResult
}

// Resolve to the first available agent, preferring a *second* model so the review
// is genuinely cross-model. claude last => a Claude-only box degrades to self-review.
const RESOLUTION_ORDER: Agent[] = ['codex', 'gemini', 'claude']

export function runReview(targetDir: string, opts: RunReviewOptions = {}): number {
  const available = opts.isAvailable ?? isAgentAvailable
  let reviewer = opts.reviewer
  if (reviewer) {
    if (!available(reviewer)) {
      console.error(`Reviewer agent CLI "${reviewer}" was not found on PATH. Install it, or pick another with --reviewer=<claude|codex|gemini>.`)
      return 2
    }
  } else {
    reviewer = RESOLUTION_ORDER.find(a => available(a))
    if (!reviewer) {
      console.error('No agent CLI (claude|codex|gemini) found on PATH. Install one to run a review.')
      return 2
    }
    if (reviewer === 'claude') {
      console.log('Note: only Claude is available — this is a self-review, not cross-model.')
    }
  }

  const scope = opts.base
    ? `the diff ${opts.base}..HEAD`
    : 'the uncommitted working-tree changes (working tree + staged)'
  const prompt = buildStandaloneReviewPrompt(scope, opts.focus)
  const idleMs = resolveIdleMs(opts.timeoutMinutes, undefined)
  const inv = buildWatchdogInvocation(agentInvocation(reviewer, prompt, targetDir), idleMs)

  console.log(`Reviewing ${scope} with ${reviewer}...`)
  const run = opts.run ?? runAgent
  const result = run(inv)
  if (result.success) {
    console.log(`✓ ${reviewer} approved`)
    return 0
  }
  console.log(`✗ ${reviewer} found issues (${result.summary})`)
  return 1
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/review/command.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/review/command.ts tests/review/command.test.ts
git commit -m "feat(review): yoke review command (cross-model gate, reviewer resolution)"
```

---

### Task 4: CLI wiring for `yoke review`

**Files:**
- Modify: `src/cli.ts` (import + `case 'review'` + usage string)

- [ ] **Step 1: Add the import**

At the top of `src/cli.ts`, after the `runContextInit` import:

```ts
import { runReview } from './review/command.js'
```

- [ ] **Step 2: Add the `case 'review'` block**

Insert before `case 'design-scan':` in `main()`:

```ts
    case 'review': {
      const targetDir = rest.find(a => !a.startsWith('-')) ?? '.'
      const valid = ['claude', 'codex', 'gemini']
      const reviewerArg = rest.find(a => a.startsWith('--reviewer='))?.slice('--reviewer='.length)
      if (reviewerArg && !valid.includes(reviewerArg)) {
        console.error(`Invalid --reviewer value: ${reviewerArg} (expected claude|codex|gemini)`)
        return 1
      }
      const base = rest.find(a => a.startsWith('--base='))?.slice('--base='.length)
      const focus = rest.find(a => a.startsWith('--focus='))?.slice('--focus='.length)
      const toArg = rest.find(a => a.startsWith('--timeout='))
      let timeoutMinutes: number | undefined
      if (toArg) {
        const v = Number(toArg.slice('--timeout='.length))
        if (!Number.isFinite(v) || v < 0) { console.error(`Invalid --timeout value: ${toArg}`); return 1 }
        timeoutMinutes = v
      }
      return runReview(targetDir, { reviewer: reviewerArg as any, base, focus, timeoutMinutes })
    }
```

- [ ] **Step 3: Update the default usage string**

Replace the `default:` usage line to include review:

```ts
      console.log('usage: yoke <validate [canonDir] | retrofit [targetDir] [--agent=claude,codex,gemini|all] [--code-graph=graphify|serena] [--loop] | loop <on|off|status|run> | context <init|status> | review [dir] [--reviewer=<claude|codex|gemini>] [--base=<ref>] [--focus="..."] | design-scan [dir] [--max=N] [--report]>')
```

- [ ] **Step 4: Build + smoke test**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx tsx src/cli.ts review --reviewer=bogus`
Expected: prints `Invalid --reviewer value: bogus ...` and exits 1.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): wire yoke review"
```

---

### Task 5: gstack compose section in the Claude planner

**Files:**
- Modify: `src/retrofit/planners/claude.ts`
- Test: `tests/retrofit/gstack-compose.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/retrofit/gstack-compose.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { planClaude } from '../../src/retrofit/planners/claude.js'
import { planCodex } from '../../src/retrofit/planners/codex.js'
import { planGemini } from '../../src/retrofit/planners/gemini.js'

const canonDir = fileURLToPath(new URL('../../canon', import.meta.url))
const claudeMd = (actions: { target: string; content: string }[]) =>
  actions.find(a => a.target === 'CLAUDE.md')?.content ?? ''

describe('gstack compose in Claude planner', () => {
  it('adds a Composed tools section to CLAUDE.md when gstack is detected', () => {
    const md = claudeMd(planClaude(canonDir, '.', false, 'graphify', true))
    expect(md).toMatch(/Composed tools/i)
    expect(md).toContain('/qa')
    expect(md).toContain('/cso')
    expect(md).toContain('/ship')
  })
  it('omits the section when gstack is not detected', () => {
    const md = claudeMd(planClaude(canonDir, '.', false, 'graphify', false))
    expect(md).not.toMatch(/Composed tools/i)
  })
  it('never adds the section to Codex or Gemini artifacts', () => {
    for (const content of [...planCodex(canonDir, '.', 'graphify'), ...planGemini(canonDir, '.', 'graphify')].map(a => a.content)) {
      expect(content).not.toMatch(/Composed tools/i)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/retrofit/gstack-compose.test.ts`
Expected: FAIL — `planClaude` ignores the 5th arg; CLAUDE.md has no "Composed tools".

- [ ] **Step 3: Implement in `src/retrofit/planners/claude.ts`**

Add the import at the top:

```ts
import { detectGstack } from '../gstack.js'
```

Replace the `claudeMd` template and `planClaude` signature. New `claudeMd`:

```ts
const GSTACK_COMPOSE = `## Composed tools (gstack detected)

This project also has [gstack](https://github.com/garrytan/gstack) installed. For capabilities Yoke does not ship, prefer gstack's skills:

- Live-browser QA → \`/qa\`
- Security audit → \`/cso\`
- Ship / deploy → \`/ship\`, \`/land-and-deploy\`
`

const claudeMd = (rtkNote: string, composeNote: string) => `# Project Instructions

This project uses the Yoke harness. Baseline instructions:

@AGENTS.md
${rtkNote ? `\n${rtkNote}\n` : ''}${composeNote ? `\n${composeNote}\n` : ''}`
```

Update the signature and the CLAUDE.md action:

```ts
export function planClaude(
  canonDir: string,
  targetDir: string,
  wslAvailable: boolean = hasWsl(),
  codeGraph: CodeGraph = 'graphify',
  gstackDetected: boolean = detectGstack(targetDir),
): Action[] {
```

And in the CLAUDE.md write action, pass the compose note:

```ts
  actions.push({
    kind: 'write',
    target: 'CLAUDE.md',
    content: claudeMd(rtkHookable ? '' : rtkInstruction(), gstackDetected ? GSTACK_COMPOSE : ''),
    reason: 'Claude entry importing AGENTS.md',
  })
```

Note: `planClaude`'s `targetDir` param is currently named `_targetDir` and unused — rename it to `targetDir` since detection now uses it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/retrofit/gstack-compose.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/retrofit/planners/claude.ts tests/retrofit/gstack-compose.test.ts
git commit -m "feat(retrofit): compose with gstack via Claude-only CLAUDE.md note"
```

---

### Task 6: Canon `review` skill mention + gstack attribution

**Files:**
- Modify: `canon/skills/review/SKILL.md` (add a short note about `yoke review`)
- Modify: `canon/skills/ATTRIBUTION.md` (credit gstack `/codex` idea)

- [ ] **Step 1: Add the `yoke review` note to the review skill**

Append to `canon/skills/review/SKILL.md` a short section (keep the skill's existing voice):

```markdown

## Interactive cross-model review

Outside the loop, run `yoke review` to have a *second* model review your current diff
before you commit or push. It resolves to the first available of codex → gemini → claude
(preferring a model other than the one you are driving), reviews the uncommitted working
tree by default (or `--base=<ref>` for a branch range), and exits non-zero if it finds a
blocking issue — so it chains as a gate (`... && yoke review`) or a pre-push hook.
This is the interactive counterpart to the loop's `--review`/`--reviewer`.
```

- [ ] **Step 2: Add the attribution entry**

In `canon/skills/ATTRIBUTION.md`, before the MIT License block, add:

```markdown
### gstack (cross-model review, idea credit)

The interactive `yoke review` command is inspired by gstack's `/codex` skill
(https://github.com/garrytan/gstack, MIT © Garry Tan) — an independent second-model
review with a pass/fail gate. Yoke's implementation is native and cross-agent; no code
or data was copied.
```

- [ ] **Step 3: Verify canon still validates**

Run: `npx vitest run tests/canon/real-canon.test.ts`
Expected: PASS (canon validates with zero errors; existing assertions unaffected).

- [ ] **Step 4: Commit**

```bash
git add canon/skills/review/SKILL.md canon/skills/ATTRIBUTION.md
git commit -m "docs(canon): yoke review note in review skill + gstack attribution"
```

---

### Task 7: README + full green + tsc

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a `yoke review` section + gstack-compose note to README**

Add a section documenting `yoke review` (usage, reviewer resolution, `--base`/`--focus`,
exit-code gate) near the loop/verify docs, and a short "Composes with gstack" note under the
cross-agent/retrofit section explaining that if gstack is installed, retrofit routes Claude to
it for QA/security/deploy — with no bundling or dependency. Keep the README's existing tone.

- [ ] **Step 2: Bump the test-count badge**

Run the full suite first to get the exact number:

Run: `npx vitest run`
Expected: all tests PASS. Note the total count.

Update the test-count badge/references in `README.md` to the new total (previous: 244;
new total = 244 + tests added here: standalone-review 3 + gstack 3 + review command 9 +
gstack-compose 3 = **262**, unless the runner reports a different number — use the actual
number vitest prints).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): yoke review + composes-with-gstack; test count -> <N>"
```

---

## Self-Review

**Spec coverage:**
- Part 1 `yoke review` (scope default + `--base`, reviewer resolution codex→gemini→claude
  + self-review fallback + no-agent error, story-less prompt, `--focus`, exit-code gate,
  watchdog) → Tasks 1, 3, 4. ✓
- Part 2 gstack detect + Claude-only compose note, never on Codex/Gemini → Tasks 2, 5. ✓
- Part 3 tests + README + review-skill mention + attribution → Tasks 1–7. ✓

**Type consistency:** `Invocation`, `AgentResult`, `agentInvocation`, `buildWatchdogInvocation`,
`resolveIdleMs`, `Agent` are all imported from their existing modules with the same names used
where defined. `runReview(targetDir, opts)` signature matches its test and CLI caller.
`buildStandaloneReviewPrompt(scope, focus?)` matches its test and the review command caller.
`planClaude(canonDir, targetDir, wslAvailable, codeGraph, gstackDetected)` — the 5th param is
additive and defaulted, so `PLANNERS.claude = (c,t,cg) => planClaude(c,t,undefined,cg)` still
compiles (gstackDetected defaults to `detectGstack(targetDir)`).

**Placeholder scan:** README Task 7 Step 1 is descriptive prose (doc content, not code) — the
exact wording is left to the author's judgement, which is acceptable for a docs task; every
code step shows complete code. Test-count math is shown but flagged to use vitest's actual output.
