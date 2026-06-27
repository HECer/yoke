# Forge — Baustein B3 (non-destructive settings merge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `forge retrofit` MERGE into an existing `.claude/settings.json` (preserving the user's other keys and not duplicating our hook) instead of replacing it.

**Architecture:** Add an optional `merge` flag to `Action`. `applyActions` gains a JSON deep-merge path: when `merge` is set and the target exists, it parses both, deep-merges (objects recursive; arrays concatenated + de-duplicated), backs up the original, and writes the merged result (status `merged`). The Claude planner marks only `.claude/settings.json` with `merge: true`. A pure `mergeJson` util holds the merge semantics. Baustein B3 of the Forge spec.

**Tech Stack:** Node.js (ESM), TypeScript, vitest. Extends B1/B2 `apply.ts`, `report.ts`, `planners/claude.ts`.

**Builds on:** A+B1+B2+C1+C2 on `main`. Modifies: `src/retrofit/apply.ts` (`Action` is defined in `plan.ts`; `AppliedAction` here), `src/retrofit/report.ts`, `src/retrofit/planners/claude.ts`.

---

## File Structure

```
src/retrofit/
  merge-json.ts   # NEW: mergeJson(base, incoming) deep merge (pure)
  plan.ts         # MODIFY: Action gains optional `merge?: boolean`
  apply.ts        # MODIFY: AppliedAction status gains 'merged'; merge path in applyActions
  report.ts       # MODIFY: count/format 'merged'
  planners/claude.ts  # MODIFY: mark .claude/settings.json action with merge: true
tests/retrofit/
  merge-json.test.ts        # NEW
  apply.test.ts             # MODIFY: merge-into-existing case
  report.test.ts            # MODIFY: merged count
  planners-claude.test.ts   # MODIFY: settings.json carries merge:true
```

---

### Task 1: mergeJson util

**Files:**
- Create: `src/retrofit/merge-json.ts`
- Test: `tests/retrofit/merge-json.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/retrofit/merge-json.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mergeJson } from '../../src/retrofit/merge-json.js'

describe('mergeJson', () => {
  it('preserves keys only present in base', () => {
    expect(mergeJson({ model: 'opus', x: 1 }, { y: 2 })).toEqual({ model: 'opus', x: 1, y: 2 })
  })

  it('recursively merges nested objects', () => {
    expect(mergeJson({ a: { p: 1 } }, { a: { q: 2 } })).toEqual({ a: { p: 1, q: 2 } })
  })

  it('concatenates arrays and de-dupes by structural equality', () => {
    expect(mergeJson({ h: [{ k: 1 }] }, { h: [{ k: 1 }, { k: 2 }] })).toEqual({ h: [{ k: 1 }, { k: 2 }] })
  })

  it('incoming primitive overrides base on the same key', () => {
    expect(mergeJson({ a: 1 }, { a: 2 })).toEqual({ a: 2 })
  })

  it('incoming wins when types mismatch', () => {
    expect(mergeJson({ a: { p: 1 } }, { a: 5 })).toEqual({ a: 5 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- merge-json`
Expected: FAIL — cannot find module `src/retrofit/merge-json.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/retrofit/merge-json.ts`:
```ts
type Json = unknown

function isPlainObject(v: Json): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Deep-merge two parsed JSON values. Objects merge by key (recursing on shared
// keys). Arrays concatenate with structural de-duplication. For any other type
// mismatch or primitive collision, the incoming value wins.
export function mergeJson(base: Json, incoming: Json): Json {
  if (isPlainObject(base) && isPlainObject(incoming)) {
    const out: Record<string, Json> = { ...base }
    for (const [key, value] of Object.entries(incoming)) {
      out[key] = key in base ? mergeJson(base[key], value) : value
    }
    return out
  }
  if (Array.isArray(base) && Array.isArray(incoming)) {
    const out = [...base]
    for (const item of incoming) {
      if (!out.some(existing => JSON.stringify(existing) === JSON.stringify(item))) {
        out.push(item)
      }
    }
    return out
  }
  return incoming
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- merge-json`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/retrofit/merge-json.ts tests/retrofit/merge-json.test.ts
git commit -m "feat: add JSON deep-merge utility"
```

---

### Task 2: Merge path in applyActions

**Files:**
- Modify: `src/retrofit/plan.ts` (Action interface), `src/retrofit/apply.ts`
- Test: `tests/retrofit/apply.test.ts` (extend)

- [ ] **Step 1: Add failing tests**

Append to `tests/retrofit/apply.test.ts` (inside the existing `describe`):
```ts
  it('merges a merge-flagged JSON action into an existing file, preserving user keys', () => {
    writeFileSync(join(target, 'settings.json'), JSON.stringify({ model: 'opus', hooks: { A: [1] } }))
    const mergeAction: Action = {
      kind: 'write', target: 'settings.json', merge: true,
      content: JSON.stringify({ hooks: { A: [1], B: [2] } }), reason: 'settings',
    }
    const res = applyActions([mergeAction], target, { backupDir: backupDir() })
    expect(res[0].status).toBe('merged')
    expect(res[0].backedUp).toBeDefined()
    const written = JSON.parse(readFileSync(join(target, 'settings.json'), 'utf8'))
    expect(written.model).toBe('opus')          // user key preserved
    expect(written.hooks.A).toEqual([1])         // de-duped, not [1,1]
    expect(written.hooks.B).toEqual([2])         // ours added
  })

  it('treats a merge action as a plain create when the file does not exist', () => {
    const mergeAction: Action = {
      kind: 'write', target: 'fresh.json', merge: true,
      content: JSON.stringify({ a: 1 }), reason: 'x',
    }
    const res = applyActions([mergeAction], target, { backupDir: backupDir() })
    expect(res[0].status).toBe('created')
    expect(JSON.parse(readFileSync(join(target, 'fresh.json'), 'utf8'))).toEqual({ a: 1 })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- retrofit/apply`
Expected: FAIL — `Action` has no `merge`; `applyActions` produces no `merged` status.

- [ ] **Step 3: Add `merge` to the `Action` interface in `src/retrofit/plan.ts`**

```ts
export interface Action {
  kind: 'write'
  target: string
  content: string
  reason: string
  merge?: boolean
}
```

- [ ] **Step 4: Add the merge path to `src/retrofit/apply.ts`**

Add the import at the top:
```ts
import { mergeJson } from './merge-json.js'
```

Extend the `AppliedAction` status union:
```ts
export interface AppliedAction {
  target: string
  status: 'created' | 'overwritten' | 'unchanged' | 'merged'
  backedUp?: string
  reason: string
}
```

In `applyActions`, inside the `if (existsSync(dest))` branch, handle merge before the plain overwrite. Replace the existing `if (existsSync(dest)) { ... }` block with:
```ts
    if (existsSync(dest)) {
      const current = readFileSync(dest, 'utf8')

      if (action.merge) {
        const merged = JSON.stringify(mergeJson(JSON.parse(current), JSON.parse(action.content)), null, 2) + '\n'
        if (merged === current) {
          results.push({ target: action.target, status: 'unchanged', reason: action.reason })
          continue
        }
        backedUp = join(opts.backupDir, action.target)
        mkdirSync(dirname(backedUp), { recursive: true })
        copyFileSync(dest, backedUp)
        mkdirSync(dirname(dest), { recursive: true })
        writeFileSync(dest, merged)
        results.push({ target: action.target, status: 'merged', backedUp, reason: action.reason })
        continue
      }

      if (current === action.content) {
        results.push({ target: action.target, status: 'unchanged', reason: action.reason })
        continue
      }
      backedUp = join(opts.backupDir, action.target)
      mkdirSync(dirname(backedUp), { recursive: true })
      copyFileSync(dest, backedUp)
      status = 'overwritten'
    } else {
      status = 'created'
    }
```
(Keep the rest of the loop — the final `mkdirSync(dirname(dest)...)` + `writeFileSync(dest, action.content)` + `results.push` for the non-merge create/overwrite path — unchanged.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- retrofit/apply`
Expected: PASS (existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git add src/retrofit/plan.ts src/retrofit/apply.ts tests/retrofit/apply.test.ts
git commit -m "feat: merge JSON actions into existing files non-destructively"
```

---

### Task 3: Report counts merged

**Files:**
- Modify: `src/retrofit/report.ts`
- Test: `tests/retrofit/report.test.ts` (extend)

- [ ] **Step 1: Add a failing test**

In `tests/retrofit/report.test.ts`, add a `merged` action to the `applied` fixture array and a test:
```ts
  it('counts merged actions in the summary', () => {
    const out = formatReport(
      [{ target: '.claude/settings.json', status: 'merged', backedUp: '/b', reason: 'settings' }],
      { loopEnabled: false, detectedAgents: [] },
    )
    expect(out).toContain('1 merged')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- retrofit/report`
Expected: FAIL — summary has no merged count.

- [ ] **Step 3: Update `src/retrofit/report.ts`**

In `formatReport`, add `merged` to the summary line. Change the summary push to:
```ts
  lines.push(`Summary: ${count('created')} created, ${count('overwritten')} overwritten, ${count('merged')} merged, ${count('unchanged')} unchanged`)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- retrofit/report`
Expected: PASS (existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add src/retrofit/report.ts tests/retrofit/report.test.ts
git commit -m "feat: report merged-action count"
```

---

### Task 4: Claude planner marks settings.json as merge

**Files:**
- Modify: `src/retrofit/planners/claude.ts`
- Test: `tests/retrofit/planners-claude.test.ts` (extend)

- [ ] **Step 1: Add a failing test**

In `tests/retrofit/planners-claude.test.ts`, add (the WSL-true path emits settings.json):
```ts
  it('marks .claude/settings.json as a merge action', () => {
    const settings = planClaude(canon, '/t', true).find(a => a.target === '.claude/settings.json')!
    expect(settings.merge).toBe(true)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- planners-claude`
Expected: FAIL — the settings action has no `merge: true`.

- [ ] **Step 3: Update `src/retrofit/planners/claude.ts`**

In the `if (rtkHookable)` block, add `merge: true` to the `.claude/settings.json` action:
```ts
    actions.push({
      kind: 'write',
      target: '.claude/settings.json',
      merge: true,
      content: JSON.stringify({
        _forge: 'Generated by forge retrofit. A pre-existing .claude/settings.json (if any) was backed up under .forge/backup/.',
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook' }] }],
        },
      }, null, 2) + '\n',
      reason: 'rtk PreToolUse hook (WSL detected)',
    })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- planners-claude`
Expected: PASS (existing + 1 new).

- [ ] **Step 5: Run the full suite + build**

Run: `npm test`
Expected: all pass.

Run: `npm run build`
Expected: tsc 0 errors.

Run: `npm run forge -- validate canon`
Expected: `✓ canon valid (canon)`.

- [ ] **Step 6: Commit**

```bash
git add src/retrofit/planners/claude.ts tests/retrofit/planners-claude.test.ts
git commit -m "feat: mark .claude/settings.json as a non-destructive merge"
```

---

## Self-Review

**1. Spec coverage (B3 scope):**
- Merge into existing `.claude/settings.json` (preserve user keys, no hook duplication) → Tasks 1, 2, 4 ✓
- Generalizable merge mechanism (`Action.merge` + `mergeJson`) → Tasks 1, 2 ✓
- Still non-destructive (backup before merge-write) → Task 2 ✓
- Idempotent (merge equal → unchanged) → Task 2 ✓
- Report reflects merges → Task 3 ✓

**2. Placeholder scan:** No TBD/TODO; every step has complete code.

**3. Type consistency:** `mergeJson`, `Action.merge?`, `AppliedAction.status` (now includes `merged`), `formatReport` — consistent. The merge path reuses the existing backup mechanism. `JSON.stringify(..., null, 2) + '\n'` formatting matches how the planner generates the content so idempotency holds. ✓

## Next Plans (not this document)

- **Plan C3 — Multi-agent runners + worktree isolation + review-iteration.**
