# Baustein E — Context Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Yoke agent (loop + interactive) a durable `.yoke/context/` it reads before implementing and auto-logs decisions back to, closing the spec-drift hole.

**Architecture:** A new pure `src/context/` module (load/format/append). The loop runner injects bounded context into the agent + reviewer prompts (read path); `loop.ts` appends a `DECISIONS.md` entry that rides the story's atomic commit (write path). Retrofit scaffolds the three files non-destructively via a new `ifAbsent` action; a `maintaining-context` skill propagates the convention to all three agents.

**Tech Stack:** Node.js + TypeScript, vitest, zod (existing), `yaml` (existing). ESM with `.js` import specifiers.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/context/context.ts` (create) | Pure: `ProjectContext`, `loadContext`, `formatForPrompt`, `appendDecision`, `contextDir` |
| `tests/context/context.test.ts` (create) | Unit tests for the above |
| `canon/context/{PROJECT,DECISIONS,KNOWLEDGE}.md` (create) | Scaffold templates |
| `canon/skills/maintaining-context/SKILL.md` (create) | Agent-facing convention |
| `canon/manifest.yaml` (modify) | Register the new skill |
| `src/retrofit/plan.ts` (modify) | `Action.ifAbsent`; prepend base context actions |
| `src/retrofit/apply.ts` (modify) | Honour `ifAbsent` (skip existing, no backup) |
| `src/retrofit/context-actions.ts` (create) | `baseContextActions(canonDir)` shared by retrofit + CLI |
| `src/loop/runner.ts` (modify) | `buildClaudePrompt`/`buildReviewPrompt` context param; `contextBlockFor`; wire into `makeRunner`/`makeReviewRunner` |
| `src/loop/loop.ts` (modify) | Append decision before the atomic commit; rollback on failure; isolate path |
| `src/cli.ts` (modify) | `yoke context init|status` |
| `tests/...` (create/modify) | Coverage per task |
| `README.md` (modify) | Document the Context layer |

**Constants:** `MAX_CONTEXT_CHARS = 2000` (per file, in `context.ts`).

**Bounding rule:** `PROJECT.md` and `KNOWLEDGE.md` are curated (important content at the top) → **head**-bound. `DECISIONS.md` is an append-only log (recent at the bottom) → **tail**-bound. Truncation inserts a `… (truncated)` marker.

---

### Task 1: context module — types, loadContext, formatForPrompt

**Files:**
- Create: `src/context/context.ts`
- Test: `tests/context/context.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/context/context.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadContext, formatForPrompt, contextDir } from '../../src/context/context.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-ctx-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('contextDir', () => {
  it('resolves under .yoke/context', () => {
    expect(contextDir('/proj')).toBe(join('/proj', '.yoke', 'context'))
  })
})

describe('loadContext', () => {
  it('returns empty strings when no files exist', () => {
    expect(loadContext(dir)).toEqual({ project: '', decisions: '', knowledge: '' })
  })

  it('reads each file that is present', () => {
    writeFileSync(join(dir, 'PROJECT.md'), 'goal')
    writeFileSync(join(dir, 'KNOWLEDGE.md'), 'gotcha')
    const ctx = loadContext(dir)
    expect(ctx.project).toBe('goal')
    expect(ctx.knowledge).toBe('gotcha')
    expect(ctx.decisions).toBe('')
  })
})

describe('formatForPrompt', () => {
  it('returns empty string when all files are empty', () => {
    expect(formatForPrompt({ project: '', decisions: '', knowledge: '' })).toBe('')
  })

  it('includes a header and only the non-empty sections', () => {
    const out = formatForPrompt({ project: 'GOAL', decisions: '', knowledge: 'GOTCHA' })
    expect(out).toContain('Project context')
    expect(out).toContain('GOAL')
    expect(out).toContain('GOTCHA')
    expect(out).not.toContain('Recent decisions')
  })

  it('head-bounds PROJECT and tail-bounds DECISIONS', () => {
    const project = 'P'.repeat(50) + 'TAILP'
    const decisions = 'HEADD' + 'D'.repeat(50)
    const out = formatForPrompt({ project, decisions, knowledge: '' }, 10)
    expect(out).toContain('PPPPPPPPPP')        // head of PROJECT kept
    expect(out).not.toContain('TAILP')          // tail of PROJECT dropped
    expect(out).toContain('DDDDDDDDDD')          // tail of DECISIONS kept
    expect(out).not.toContain('HEADD')           // head of DECISIONS dropped
    expect(out).toContain('truncated')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/context/context.test.ts`
Expected: FAIL — `Cannot find module '../../src/context/context.js'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/context/context.ts
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const MAX_CONTEXT_CHARS = 2000

export interface ProjectContext {
  project: string
  decisions: string
  knowledge: string
}

export function contextDir(targetDir: string): string {
  return join(targetDir, '.yoke', 'context')
}

function readIf(file: string): string {
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

export function loadContext(dir: string): ProjectContext {
  return {
    project: readIf(join(dir, 'PROJECT.md')),
    decisions: readIf(join(dir, 'DECISIONS.md')),
    knowledge: readIf(join(dir, 'KNOWLEDGE.md')),
  }
}

function boundHead(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '\n… (truncated)'
}

function boundTail(s: string, max: number): string {
  return s.length <= max ? s : '… (truncated)\n' + s.slice(s.length - max)
}

export function formatForPrompt(ctx: ProjectContext, max: number = MAX_CONTEXT_CHARS): string {
  const parts: string[] = []
  if (ctx.project.trim()) parts.push(`### North star (PROJECT.md)\n${boundHead(ctx.project.trim(), max)}`)
  if (ctx.knowledge.trim()) parts.push(`### Known gotchas (KNOWLEDGE.md)\n${boundHead(ctx.knowledge.trim(), max)}`)
  if (ctx.decisions.trim()) parts.push(`### Recent decisions (DECISIONS.md)\n${boundTail(ctx.decisions.trim(), max)}`)
  if (parts.length === 0) return ''
  return ['## Project context (from .yoke/context — read before implementing)', ...parts].join('\n\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/context/context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/context/context.ts tests/context/context.test.ts
git commit -m "feat(context): loadContext + formatForPrompt with head/tail bounding"
```

---

### Task 2: context module — appendDecision + rollback

**Files:**
- Modify: `src/context/context.ts`
- Test: `tests/context/context.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing test**

```typescript
// add to tests/context/context.test.ts
import { readFileSync, existsSync } from 'node:fs'
import { appendDecision } from '../../src/context/context.js'

describe('appendDecision', () => {
  const entry = { storyId: 'S1', title: 'First story', summary: 'did the thing' }
  const fixedDate = new Date('2026-06-28T12:00:00Z')

  it('creates DECISIONS.md when absent and writes a dated heading', () => {
    appendDecision(dir, entry, fixedDate)
    const text = readFileSync(join(dir, 'DECISIONS.md'), 'utf8')
    expect(text).toContain('## 2026-06-28 — S1: First story')
    expect(text).toContain('did the thing')
  })

  it('appends to existing content without clobbering it', () => {
    writeFileSync(join(dir, 'DECISIONS.md'), '# Decisions\n\nold entry\n')
    appendDecision(dir, entry, fixedDate)
    const text = readFileSync(join(dir, 'DECISIONS.md'), 'utf8')
    expect(text).toContain('old entry')
    expect(text.indexOf('old entry')).toBeLessThan(text.indexOf('S1'))
  })

  it('rollback restores prior content', () => {
    writeFileSync(join(dir, 'DECISIONS.md'), 'PRIOR\n')
    const { rollback } = appendDecision(dir, entry, fixedDate)
    rollback()
    expect(readFileSync(join(dir, 'DECISIONS.md'), 'utf8')).toBe('PRIOR\n')
  })

  it('rollback removes the file when it did not exist before', () => {
    const { rollback } = appendDecision(dir, entry, fixedDate)
    rollback()
    expect(existsSync(join(dir, 'DECISIONS.md'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/context/context.test.ts`
Expected: FAIL — `appendDecision is not exported`

- [ ] **Step 3: Write minimal implementation**

Add to `src/context/context.ts` (update the `node:fs` import to include `mkdirSync`, `writeFileSync`, `rmSync`, and `node:path` to include `dirname`):

```typescript
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'

export interface DecisionEntry {
  storyId: string
  title: string
  summary: string
}

export function appendDecision(
  dir: string,
  entry: DecisionEntry,
  now: Date = new Date(),
): { rollback: () => void } {
  const file = join(dir, 'DECISIONS.md')
  const existed = existsSync(file)
  const prior = existed ? readFileSync(file, 'utf8') : ''
  const date = now.toISOString().slice(0, 10)
  const block = `\n## ${date} — ${entry.storyId}: ${entry.title}\n${entry.summary}\n`
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, prior + block)
  return {
    rollback: () => {
      if (existed) writeFileSync(file, prior)
      else { try { rmSync(file) } catch { /* best-effort cleanup */ } }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/context/context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/context/context.ts tests/context/context.test.ts
git commit -m "feat(context): appendDecision with atomic rollback"
```

---

### Task 3: canon templates + maintaining-context skill + manifest

**Files:**
- Create: `canon/context/PROJECT.md`, `canon/context/DECISIONS.md`, `canon/context/KNOWLEDGE.md`
- Create: `canon/skills/maintaining-context/SKILL.md`
- Modify: `canon/manifest.yaml`
- Test: `tests/canon/real-canon.test.ts` (add an assertion) — verify the skill is registered and canon validates

- [ ] **Step 1: Write the failing test**

```typescript
// add to tests/canon/real-canon.test.ts (it already imports loadManifest + validateCanon against the real canon dir)
import { join } from 'node:path'
import { loadManifest } from '../../src/canon/manifest.js'

it('registers the maintaining-context skill', () => {
  const manifest = loadManifest(join('canon', 'manifest.yaml'))
  expect(manifest.skills.some(s => s.id === 'maintaining-context')).toBe(true)
})
```

> NOTE: `tests/canon/real-canon.test.ts` already runs `validateCanon('canon')` and asserts zero errors. Adding the skill must keep that green — that is the second half of this task's coverage.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/canon/real-canon.test.ts`
Expected: FAIL — `maintaining-context` not found in manifest.

- [ ] **Step 3: Create the templates and skill, then register it**

`canon/context/PROJECT.md`:
```markdown
# Project — North Star

> Edit this file. It is the durable goal every Yoke agent reads before implementing.

## Goal
<!-- One paragraph: what this project is and the outcome it must produce. -->

## Constraints
<!-- Hard limits: stack, platforms, performance, compliance. -->

## Non-goals
<!-- Explicitly out of scope. The most valuable section for preventing drift. -->

## Success criteria
<!-- How we know it works. -->
```

`canon/context/DECISIONS.md`:
```markdown
# Decisions

> Append-only ledger. The Yoke loop adds an entry per completed story; agents add
> entries for non-obvious calls made during interactive work. Newest at the bottom.
```

`canon/context/KNOWLEDGE.md`:
```markdown
# Knowledge

> Reusable gotchas, conventions, and learnings. Add a bullet whenever you discover
> something a future agent would waste time rediscovering.
```

`canon/skills/maintaining-context/SKILL.md`:
```markdown
---
name: maintaining-context
description: Use at the start of any substantial task and whenever you make a non-obvious decision or learn a reusable fact — keeps .yoke/context/ (PROJECT, DECISIONS, KNOWLEDGE) the durable source of truth so fresh-context work never drifts.
---

# Maintaining Project Context

Yoke keeps durable, cross-session context in `.yoke/context/`. These files are the
project's memory — they survive between sessions and loop iterations, so an agent
starting with a fresh context window is never blind.

## Before substantial work

1. Read `.yoke/context/PROJECT.md` — the north star (goal, constraints, **non-goals**, success criteria). Align your work to it. If the task contradicts a non-goal, stop and flag it.
2. Skim `.yoke/context/KNOWLEDGE.md` for gotchas that affect what you are about to do.

## While working

- When you make a **non-obvious decision** (a trade-off, an architectural choice, a rejected alternative), append it to `.yoke/context/DECISIONS.md`:

  ```
  ## <YYYY-MM-DD> — <short title>
  What you chose and why, in one or two lines.
  ```

- When you learn a **reusable fact or gotcha** (a non-obvious build step, an API quirk, a convention), append a bullet to `.yoke/context/KNOWLEDGE.md`.

## Rules

- Never rewrite history in `DECISIONS.md` — only append.
- Keep `PROJECT.md` curated and short; it is read into every loop prompt.
- Inside the autonomous loop, the loop appends a decision per completed story for you — you still add the *why* and any learnings.
```

Then add to `canon/manifest.yaml`, in the skills list (after the `minimal-code` entry):
```yaml
  - { id: maintaining-context, path: skills/maintaining-context, kind: methodology }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/canon/`
Expected: PASS — skill registered AND `validateCanon('canon')` still reports zero errors.

- [ ] **Step 5: Commit**

```bash
git add canon/context canon/skills/maintaining-context canon/manifest.yaml tests/canon/real-canon.test.ts
git commit -m "feat(canon): context templates + maintaining-context skill"
```

---

### Task 4: retrofit scaffolding — ifAbsent action + base context actions

**Files:**
- Modify: `src/retrofit/plan.ts` (add `ifAbsent?` to `Action`)
- Modify: `src/retrofit/apply.ts` (honour `ifAbsent`)
- Create: `src/retrofit/context-actions.ts`
- Modify: `src/retrofit/plan.ts` (`planRetrofit` prepends base context actions)
- Test: `tests/retrofit/apply.test.ts`, `tests/retrofit/plan-dispatch.test.ts`

- [ ] **Step 1: Write the failing test (apply honours ifAbsent)**

```typescript
// add to tests/retrofit/apply.test.ts (mirror its existing temp-dir + applyActions setup)
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { applyActions } from '../../src/retrofit/apply.js'

it('ifAbsent action creates the file when missing', () => {
  const d = mkdtempSync(join(tmpdir(), 'yoke-apply-'))
  const res = applyActions(
    [{ kind: 'write', target: '.yoke/context/PROJECT.md', content: 'TEMPLATE', reason: 'scaffold', ifAbsent: true }],
    d, { backupDir: join(d, '.yoke', 'backup', 'x') },
  )
  expect(res[0].status).toBe('created')
  expect(readFileSync(join(d, '.yoke/context/PROJECT.md'), 'utf8')).toBe('TEMPLATE')
  rmSync(d, { recursive: true, force: true })
})

it('ifAbsent action leaves an existing file untouched and takes no backup', () => {
  const d = mkdtempSync(join(tmpdir(), 'yoke-apply-'))
  const dest = join(d, '.yoke/context/PROJECT.md')
  mkdtempSync // ensure import used
  writeFileSync(join(d, 'placeholder'), '') // keep tmp non-empty
  const { mkdirSync } = require('node:fs')
  mkdirSync(join(d, '.yoke/context'), { recursive: true })
  writeFileSync(dest, 'USER CONTENT')
  const res = applyActions(
    [{ kind: 'write', target: '.yoke/context/PROJECT.md', content: 'TEMPLATE', reason: 'scaffold', ifAbsent: true }],
    d, { backupDir: join(d, '.yoke', 'backup', 'x') },
  )
  expect(res[0].status).toBe('unchanged')
  expect(res[0].backedUp).toBeUndefined()
  expect(readFileSync(dest, 'utf8')).toBe('USER CONTENT')
  rmSync(d, { recursive: true, force: true })
})
```

> NOTE: prefer ESM `import { mkdirSync } from 'node:fs'` at the top of the test file rather than `require`; the inline `require` above is only to keep the snippet self-contained. Use the file's existing import style.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/retrofit/apply.test.ts`
Expected: FAIL — `ifAbsent` not in `Action` type / not honoured (existing file gets overwritten).

- [ ] **Step 3: Implement ifAbsent**

In `src/retrofit/plan.ts`, extend the `Action` interface:
```typescript
export interface Action {
  kind: 'write'
  target: string
  content: string
  reason: string
  merge?: boolean
  ifAbsent?: boolean
}
```

In `src/retrofit/apply.ts`, at the **top** of the `if (existsSync(dest))` branch (before the `action.merge` check), add:
```typescript
    if (existsSync(dest)) {
      if (action.ifAbsent) {
        results.push({ target: action.target, status: 'unchanged', reason: `${action.reason} (exists, left untouched)` })
        continue
      }
      const current = readFileSync(dest, 'utf8')
      // ... existing merge / overwrite logic unchanged ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/retrofit/apply.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test (base context actions are planned once)**

```typescript
// add to tests/retrofit/plan-dispatch.test.ts (it already calls planRetrofit against the real canon dir)
import { baseContextActions } from '../../src/retrofit/context-actions.js'

it('scaffolds the three context files exactly once for --agent=all', () => {
  const actions = planRetrofit('canon', '.', ['claude', 'codex', 'gemini'])
  const ctxTargets = actions.filter(a => a.target.startsWith('.yoke/context/')).map(a => a.target)
  expect(ctxTargets.sort()).toEqual([
    '.yoke/context/DECISIONS.md',
    '.yoke/context/KNOWLEDGE.md',
    '.yoke/context/PROJECT.md',
  ])
  expect(actions.filter(a => a.target === '.yoke/context/PROJECT.md')).toHaveLength(1)
})

it('baseContextActions are all ifAbsent', () => {
  expect(baseContextActions('canon').every(a => a.ifAbsent)).toBe(true)
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/retrofit/plan-dispatch.test.ts`
Expected: FAIL — `baseContextActions` not exported; context targets absent from plan.

- [ ] **Step 7: Implement baseContextActions and wire into planRetrofit**

Create `src/retrofit/context-actions.ts`:
```typescript
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Action } from './plan.js'

const CONTEXT_FILES = ['PROJECT.md', 'DECISIONS.md', 'KNOWLEDGE.md'] as const

export function baseContextActions(canonDir: string): Action[] {
  return CONTEXT_FILES.map(name => ({
    kind: 'write',
    target: `.yoke/context/${name}`,
    content: readFileSync(join(canonDir, 'context', name), 'utf8'),
    reason: `context scaffold: ${name}`,
    ifAbsent: true,
  }))
}
```

In `src/retrofit/plan.ts`, import it and seed `planRetrofit` with the base actions before the agent loop:
```typescript
import { baseContextActions } from './context-actions.js'

export function planRetrofit(canonDir: string, targetDir: string, agents: Agent[], codeGraph: CodeGraph = 'graphify'): Action[] {
  const seen = new Set<string>()
  const merged: Action[] = []
  for (const action of baseContextActions(canonDir)) {
    seen.add(action.target)
    merged.push(action)
  }
  for (const agent of agents) {
    for (const action of PLANNERS[agent](canonDir, targetDir, codeGraph)) {
      if (seen.has(action.target)) continue
      seen.add(action.target)
      merged.push(action)
    }
  }
  return merged
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/retrofit/`
Expected: PASS (plan-dispatch + apply + existing retrofit tests all green).

- [ ] **Step 9: Commit**

```bash
git add src/retrofit/plan.ts src/retrofit/apply.ts src/retrofit/context-actions.ts tests/retrofit/apply.test.ts tests/retrofit/plan-dispatch.test.ts
git commit -m "feat(retrofit): scaffold .yoke/context via non-destructive ifAbsent actions"
```

---

### Task 5: loop read path — inject context into agent + reviewer prompts

**Files:**
- Modify: `src/loop/runner.ts`
- Test: `tests/loop/runner.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// add to tests/loop/runner.test.ts
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildClaudePrompt, buildReviewPrompt, contextBlockFor } from '../../src/loop/runner.js'

const story = { id: 'S1', title: 'First', priority: 1, acceptance: ['x'], passes: false }

describe('prompt context injection', () => {
  it('buildClaudePrompt omits the context section when no context is given', () => {
    const p = buildClaudePrompt(story)
    expect(p).not.toContain('Project context')
    expect(p).toContain('Story S1: First')
  })

  it('buildClaudePrompt includes the context block when provided', () => {
    const p = buildClaudePrompt(story, '## Project context\nGOAL')
    expect(p).toContain('## Project context')
    expect(p).toContain('GOAL')
    expect(p.indexOf('GOAL')).toBeLessThan(p.indexOf('Story S1'))
  })

  it('buildReviewPrompt includes the context block when provided', () => {
    expect(buildReviewPrompt(story, '## Project context\nGOAL')).toContain('GOAL')
  })

  it('contextBlockFor reads .yoke/context under the target dir', () => {
    const d = mkdtempSync(join(tmpdir(), 'yoke-cbf-'))
    mkdirSync(join(d, '.yoke', 'context'), { recursive: true })
    writeFileSync(join(d, '.yoke', 'context', 'PROJECT.md'), 'NORTHSTAR')
    expect(contextBlockFor(d)).toContain('NORTHSTAR')
    expect(contextBlockFor(mkdtempSync(join(tmpdir(), 'yoke-empty-')))).toBe('')
    rmSync(d, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/loop/runner.test.ts`
Expected: FAIL — `contextBlockFor` not exported; `buildClaudePrompt` takes no second arg.

- [ ] **Step 3: Implement context-aware prompts + wiring**

In `src/loop/runner.ts`, add the import and helper near the top:
```typescript
import { loadContext, formatForPrompt, contextDir } from '../context/context.js'

export function contextBlockFor(targetDir: string): string {
  return formatForPrompt(loadContext(contextDir(targetDir)))
}
```

Replace `buildClaudePrompt` and `buildReviewPrompt` with context-aware versions:
```typescript
export function buildClaudePrompt(story: Story, context = ''): string {
  const criteria = story.acceptance.map(a => `- ${a}`).join('\n')
  const lines = [
    'You are an autonomous coding agent running inside the Yoke loop.',
    'Implement ONLY this story and nothing else. Follow test-driven development.',
  ]
  if (context) lines.push('', context)
  lines.push(
    '',
    `Story ${story.id}: ${story.title}`,
    'Acceptance criteria (Definition of Done):',
    criteria,
    '',
    "When done, ensure the project's full test suite passes.",
    'Do NOT commit — the loop commits on your behalf after verifying.',
  )
  return lines.join('\n')
}

export function buildReviewPrompt(story: Story, context = ''): string {
  const criteria = story.acceptance.map(a => `- ${a}`).join('\n')
  const lines = [
    'You are an independent reviewer inside the Yoke loop. You did NOT implement this change.',
    'Review the current uncommitted working-tree changes against the story below.',
  ]
  if (context) lines.push('', context)
  lines.push(
    '',
    `Story ${story.id}: ${story.title}`,
    'Acceptance criteria:',
    criteria,
    '',
    'Approve by exiting 0 ONLY if every acceptance criterion is met and the change is sound.',
    'If you find ANY blocking issue (an unmet criterion, a bug, a missing test), exit non-zero to reject.',
    'Do not modify files. Do not commit.',
  )
  return lines.join('\n')
}
```

In `makeRunner`, pass the context block:
```typescript
    const inv = agentInvocation(agent, buildClaudePrompt(ctx.story, contextBlockFor(ctx.targetDir)), ctx.targetDir)
```

In `makeReviewRunner`, likewise:
```typescript
    const inv = agentInvocation(agent, buildReviewPrompt(ctx.story, contextBlockFor(ctx.targetDir)), ctx.targetDir)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/loop/runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/loop/runner.ts tests/loop/runner.test.ts
git commit -m "feat(loop): inject .yoke/context into agent + reviewer prompts"
```

---

### Task 6: loop write path — append decision on the atomic commit

**Files:**
- Modify: `src/loop/loop.ts`
- Test: `tests/loop/loop.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// add to tests/loop/loop.test.ts (reuses the existing dir / prd() / fakes)
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { contextDir } from '../../src/context/context.js'

const decisionsFile = () => join(contextDir(dir), 'DECISIONS.md')

it('appends a decision per completed story, in the commit', () => {
  const commits: string[] = []
  const git: GitOps = { isClean: () => true, commitAll: (_d, m) => commits.push(m), addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} }
  runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git, verify: verifyOk, maxIterations: 10 })
  const text = readFileSync(decisionsFile(), 'utf8')
  expect(text).toContain('S1: First')
  expect(text).toContain('S2: Second')
})

it('does not append a decision when the story is blocked at verify', () => {
  const verifyFail: Verifier = () => ({ passed: false, summary: 'red' })
  runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git: cleanGit(), verify: verifyFail, maxIterations: 10 })
  expect(existsSync(decisionsFile())).toBe(false)
})

it('reverts the decision append when the commit fails', () => {
  const failingGit: GitOps = { isClean: () => true, commitAll: () => { throw new Error('commit boom') }, addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} }
  const res = runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git: failingGit, verify: verifyOk, maxIterations: 10 })
  expect(res.status).toBe('blocked')
  expect(existsSync(decisionsFile())).toBe(false)   // rolled back
  expect(loadPrd(prd()).every(s => !s.passes)).toBe(true)  // PRD reverted too
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/loop/loop.test.ts`
Expected: FAIL — no DECISIONS.md is written.

- [ ] **Step 3: Implement the write path**

In `src/loop/loop.ts`, add the import:
```typescript
import { appendDecision, contextDir } from '../context/context.js'
```

Replace the **non-isolate** commit block (the final `try { ... } catch { ... }` around `savePrd` + `commitAll`) with:
```typescript
    const dec = appendDecision(contextDir(opts.targetDir), {
      storyId: story.id,
      title: story.title,
      summary: result.summary,
    })
    const updated = stories.map(s => (s.id === story.id ? { ...s, passes: true } : s))
    savePrd(opts.prdPath, updated)
    try {
      opts.git.commitAll(opts.targetDir, `yoke: complete ${story.id} ${story.title}`)
    } catch (e) {
      savePrd(opts.prdPath, stories) // revert — never persist passes:true without a commit
      dec.rollback()                 // and never leave an orphan decision
      return {
        status: 'blocked',
        iterations,
        reason: `commit failed for ${story.id}: ${(e as Error).message}`,
        finalProgress: progress(stories),
      }
    }
```

In the **isolate** block, append the decision in the worktree just before `savePrd(wtPrd, ...)`:
```typescript
        appendDecision(contextDir(wt), {
          storyId: story.id,
          title: story.title,
          summary: result.summary,
        })
        const updated = stories.map(s => (s.id === story.id ? { ...s, passes: true } : s))
        savePrd(wtPrd, updated)
        opts.git.commitAll(wt, `yoke: complete ${story.id} ${story.title}`)
        opts.git.integrate(opts.targetDir, wt)
```
(No explicit rollback needed in isolate: a failed iteration's worktree is discarded by the existing `finally { removeWorktree }`, so the decision never reaches the main tree.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/loop/loop.test.ts`
Expected: PASS — including the existing "blocks and reverts the PRD when the commit fails" test (now also asserting no orphan decision).

- [ ] **Step 5: Commit**

```bash
git add src/loop/loop.ts tests/loop/loop.test.ts
git commit -m "feat(loop): auto-log a decision per completed story on the atomic commit"
```

---

### Task 7: CLI — `yoke context init|status`

**Files:**
- Modify: `src/cli.ts`
- Create: `src/context/command.ts` (testable command bodies)
- Test: `tests/context/command.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/context/command.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runContextInit, runContextStatus } from '../../src/context/command.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-ctxcmd-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('runContextInit', () => {
  it('scaffolds the three files and is idempotent + non-destructive', () => {
    expect(runContextInit(dir)).toBe(0)
    const project = join(dir, '.yoke', 'context', 'PROJECT.md')
    writeFileSync(project, 'USER EDIT')
    expect(runContextInit(dir)).toBe(0)             // second run
    expect(readFileSync(project, 'utf8')).toBe('USER EDIT')  // not clobbered
  })
})

describe('runContextStatus', () => {
  it('reports absence then presence', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    runContextStatus(dir)
    expect(log.mock.calls.flat().join('\n')).toMatch(/not initialised|no .yoke\/context/i)
    runContextInit(dir)
    log.mockClear()
    runContextStatus(dir)
    expect(log.mock.calls.flat().join('\n')).toContain('PROJECT.md')
    log.mockRestore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/context/command.test.ts`
Expected: FAIL — `src/context/command.js` does not exist.

- [ ] **Step 3: Implement the command bodies**

Create `src/context/command.ts`:
```typescript
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { resolveCanonDir } from '../retrofit/canon-dir.js'
import { baseContextActions } from '../retrofit/context-actions.js'
import { applyActions } from '../retrofit/apply.js'
import { contextDir } from './context.js'

export function runContextInit(targetDir: string): number {
  const canonDir = resolveCanonDir()
  const actions = baseContextActions(canonDir)
  const applied = applyActions(actions, targetDir, { backupDir: join(targetDir, '.yoke', 'backup', 'context') })
  for (const a of applied) console.log(`  ${a.status.padEnd(11)} ${a.target}`)
  return 0
}

export function runContextStatus(targetDir: string): number {
  const dir = contextDir(targetDir)
  const files = ['PROJECT.md', 'DECISIONS.md', 'KNOWLEDGE.md']
  if (!files.some(f => existsSync(join(dir, f)))) {
    console.log('Context not initialised (no .yoke/context). Run: yoke context init')
    return 0
  }
  for (const f of files) {
    const p = join(dir, f)
    console.log(existsSync(p) ? `  ${f.padEnd(13)} ${statSync(p).size} bytes` : `  ${f.padEnd(13)} (missing)`)
  }
  const decisions = join(dir, 'DECISIONS.md')
  if (existsSync(decisions)) {
    const last = readFileSync(decisions, 'utf8').split('\n').filter(l => l.startsWith('## ')).pop()
    if (last) console.log(`  last decision: ${last.slice(3)}`)
  }
  return 0
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/context/command.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into the CLI**

In `src/cli.ts`, add the import:
```typescript
import { runContextInit, runContextStatus } from './context/command.js'
```

Add a `case` in `main`'s switch (before `default`):
```typescript
    case 'context': {
      const sub = rest[0]
      const targetDir = rest.slice(1).find(a => !a.startsWith('-')) ?? '.'
      if (sub === 'init') return runContextInit(targetDir)
      if (sub === 'status') return runContextStatus(targetDir)
      console.log('usage: yoke context <init|status> [targetDir]')
      return 1
    }
```

Update the top-level `default` usage string to include `context`:
```typescript
      console.log('usage: yoke <validate [canonDir] | retrofit [...] | loop <...> | context <init|status>>')
```

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: PASS — all tests green.

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts src/context/command.ts tests/context/command.test.ts
git commit -m "feat(cli): yoke context init|status"
```

---

### Task 8: Documentation — README Context layer section

**Files:**
- Modify: `README.md`
- Modify: `src/loop/run-command.ts` (only if a stale comment references prompt contents — otherwise skip)

- [ ] **Step 1: Add a "Context layer" section to README.md**

Insert after the loop section. Use this content:
```markdown
## Context layer (`.yoke/context/`)

Yoke keeps durable, cross-session context so a fresh-context agent is never blind:

- `PROJECT.md` — the north star (goal, constraints, non-goals, success criteria).
- `DECISIONS.md` — an append-only ledger. The loop adds an entry per completed story; you and agents add the *why*.
- `KNOWLEDGE.md` — reusable gotchas and conventions.

`yoke retrofit` scaffolds these files (non-destructively — your edits are never overwritten).
The loop reads them into every agent + reviewer prompt and logs decisions back on each story's
commit. Manage them directly with `yoke context init` and `yoke context status`. The
`maintaining-context` skill teaches agents to honour the same files during interactive work.
```

- [ ] **Step 2: Verify the docs build / links**

Run: `npx vitest run` (ensure nothing references removed symbols)
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document the Context layer"
```

---

## Self-Review

**Spec coverage:**
- Three files `.yoke/context/{PROJECT,DECISIONS,KNOWLEDGE}.md` → Task 3 (templates) + Task 4 (scaffold).
- `src/context/context.ts` (`loadContext`, `formatForPrompt`, `appendDecision`) → Tasks 1–2.
- Loop read (bounded injection into both prompts) → Task 5.
- Loop write (decision on the same atomic commit, revert both on failure, isolate-safe) → Task 6.
- Retrofit scaffolding (non-destructive, idempotent, once for all agents) → Task 4.
- `maintaining-context` skill via manifest → Task 3.
- `yoke context init|status` → Task 7.
- Backwards-compat (no `.yoke/context/` → prompt unchanged) → Task 5 step 1 first test.
- No new config keys; bound is a constant → Task 1 (`MAX_CONTEXT_CHARS`).
- Docs → Task 8.

**Placeholder scan:** No TBD/TODO. The one inline `require` in Task 4 step 1 carries an explicit NOTE to use the file's ESM import style. All code steps show complete code.

**Type consistency:** `ProjectContext`, `DecisionEntry`, `Action.ifAbsent`, `contextDir`, `baseContextActions`, `contextBlockFor`, `runContextInit`, `runContextStatus` are defined once and referenced consistently. `appendDecision` signature `(dir, entry, now?)` matches all call sites (loop omits `now` → defaults to `new Date()`; tests pass a fixed date).

**Bounding note:** `formatForPrompt(ctx, max)` defaults to `MAX_CONTEXT_CHARS`; tests pass `10` to exercise truncation deterministically.
