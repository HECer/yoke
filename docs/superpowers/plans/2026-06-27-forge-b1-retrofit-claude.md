# Forge — Baustein B1 (Retrofit-Skill, Claude Code) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `forge retrofit` command that, run in a target project, detects it, plans a **non-destructive** retrofit, generates **Claude Code** artifacts from the Canon (`.claude/skills/`, `AGENTS.md`, `CLAUDE.md`), records the loop opt-in in `.forge/config.yaml`, and reports what changed.

**Architecture:** Pure planning (`planClaudeRetrofit` reads the Canon → list of `Action`s) is separated from effectful application (`applyActions` does backup-then-write, idempotent). Detection and config IO are isolated modules. The CLI wires them. This is Baustein B1 of the Forge spec (`docs/superpowers/specs/2026-06-27-forge-cross-agent-harness-design.md`) — Claude only; Codex/Gemini + tool-MCP wiring are Baustein B2.

**Tech Stack:** Node.js (ESM), TypeScript, vitest, `yaml`. Reuses Baustein A modules (`loadManifest`, `Manifest`). Distribution via `npx`.

**Builds on:** Baustein A (already on `main`): `src/canon/manifest.ts` (`loadManifest`, `Manifest`), `src/canon/validate.ts`, `src/cli.ts` (`main` dispatch, import-safe via `isMain` guard).

---

## File Structure

```
src/
  retrofit/
    config.ts       # ForgeConfig type + loadConfig/saveConfig (.forge/config.yaml)
    detect.ts       # detectProject() -> Detection
    plan.ts         # Action type + planClaudeRetrofit(canonDir, targetDir) -> Action[]
    apply.ts        # AppliedAction type + applyActions() (non-destructive, idempotent)
    report.ts       # formatReport(applied, config) -> string
    canon-dir.ts    # resolveCanonDir() — find the bundled canon next to package.json
  cli.ts            # MODIFY: add `retrofit` subcommand
tests/
  retrofit/
    config.test.ts
    detect.test.ts
    plan.test.ts
    apply.test.ts
    report.test.ts
    retrofit.integration.test.ts
```

Each module has one responsibility: config IO, detection, pure planning, effectful apply, reporting, canon resolution. The pure/effectful split keeps planning unit-testable without a filesystem and makes apply’s backup logic independently verifiable.

---

### Task 1: Forge config IO

**Files:**
- Create: `src/retrofit/config.ts`
- Test: `tests/retrofit/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/retrofit/config.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadConfig, saveConfig, defaultConfig } from '../../src/retrofit/config.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'forge-cfg-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('forge config', () => {
  it('returns null when no config exists', () => {
    expect(loadConfig(dir)).toBeNull()
  })

  it('saves and reloads a config round-trip', () => {
    const cfg = { canonVersion: '0.1.0', agents: ['claude'] as const, loop: { enabled: true } }
    saveConfig(dir, cfg)
    expect(existsSync(join(dir, '.forge', 'config.yaml'))).toBe(true)
    expect(loadConfig(dir)).toEqual(cfg)
  })

  it('defaultConfig has loop disabled', () => {
    expect(defaultConfig('0.1.0').loop.enabled).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- retrofit/config`
Expected: FAIL — cannot find module `src/retrofit/config.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/retrofit/config.ts`:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { parse, stringify } from 'yaml'

export type Agent = 'claude' | 'codex' | 'gemini'

export interface ForgeConfig {
  canonVersion: string
  agents: Agent[]
  loop: { enabled: boolean }
}

export function defaultConfig(canonVersion: string): ForgeConfig {
  return { canonVersion, agents: [], loop: { enabled: false } }
}

export function configPath(targetDir: string): string {
  return join(targetDir, '.forge', 'config.yaml')
}

export function loadConfig(targetDir: string): ForgeConfig | null {
  const file = configPath(targetDir)
  if (!existsSync(file)) return null
  return parse(readFileSync(file, 'utf8')) as ForgeConfig
}

export function saveConfig(targetDir: string, config: ForgeConfig): void {
  const file = configPath(targetDir)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, stringify(config))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- retrofit/config`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/retrofit/config.ts tests/retrofit/config.test.ts
git commit -m "feat: add forge .forge/config.yaml IO"
```

---

### Task 2: Project detection

**Files:**
- Create: `src/retrofit/detect.ts`
- Test: `tests/retrofit/detect.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/retrofit/detect.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectProject } from '../../src/retrofit/detect.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'forge-detect-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('detectProject', () => {
  it('reports no agents in an empty project', () => {
    const d = detectProject(dir)
    expect(d.agents).toEqual([])
    expect(d.hasAgentsMd).toBe(false)
    expect(d.hasForgeConfig).toBe(false)
  })

  it('detects claude via .claude/ and a CLAUDE.md', () => {
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(join(dir, 'CLAUDE.md'), '# project')
    expect(detectProject(dir).agents).toContain('claude')
  })

  it('detects codex and gemini directories', () => {
    mkdirSync(join(dir, '.codex'), { recursive: true })
    mkdirSync(join(dir, '.gemini'), { recursive: true })
    const d = detectProject(dir)
    expect(d.agents).toContain('codex')
    expect(d.agents).toContain('gemini')
  })

  it('flags an existing AGENTS.md and .forge config', () => {
    writeFileSync(join(dir, 'AGENTS.md'), 'x')
    mkdirSync(join(dir, '.forge'), { recursive: true })
    writeFileSync(join(dir, '.forge', 'config.yaml'), 'x')
    const d = detectProject(dir)
    expect(d.hasAgentsMd).toBe(true)
    expect(d.hasForgeConfig).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- retrofit/detect`
Expected: FAIL — cannot find module `src/retrofit/detect.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/retrofit/detect.ts`:
```ts
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Agent } from './config.js'

export interface Detection {
  agents: Agent[]
  hasAgentsMd: boolean
  hasForgeConfig: boolean
}

export function detectProject(targetDir: string): Detection {
  const has = (...parts: string[]) => existsSync(join(targetDir, ...parts))
  const agents: Agent[] = []
  if (has('.claude') || has('CLAUDE.md')) agents.push('claude')
  if (has('.codex') || has('AGENTS.md')) agents.push('codex')
  if (has('.gemini') || has('GEMINI.md')) agents.push('gemini')
  return {
    agents,
    hasAgentsMd: has('AGENTS.md'),
    hasForgeConfig: has('.forge', 'config.yaml'),
  }
}
```

Note: AGENTS.md implies a Codex-style project because Codex reads AGENTS.md natively; that is acceptable detection noise for B1 (we only generate Claude artifacts here). Refined per-agent gating lands in B2.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- retrofit/detect`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/retrofit/detect.ts tests/retrofit/detect.test.ts
git commit -m "feat: add project/harness detection"
```

---

### Task 3: Plan Claude retrofit (pure)

**Files:**
- Create: `src/retrofit/plan.ts`
- Test: `tests/retrofit/plan.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/retrofit/plan.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planClaudeRetrofit } from '../../src/retrofit/plan.js'

let canon: string
beforeEach(() => {
  canon = mkdtempSync(join(tmpdir(), 'forge-canon-'))
  const w = (rel: string, c: string) => {
    mkdirSync(join(canon, rel, '..'), { recursive: true })
    writeFileSync(join(canon, rel), c)
  }
  w('manifest.yaml', `
name: forge-canon
version: 0.1.0
agents: [claude]
skills:
  - { id: tdd, path: skills/tdd, kind: methodology }
policy: []
loop: { spec: loop/loop-spec.md, prdSchema: loop/prd.schema.md }
tools: []
`)
  w('AGENTS.md', '# Forge Harness Baseline\n')
  w('skills/tdd/SKILL.md', '---\nname: tdd\ndescription: d\n---\nbody')
})
afterEach(() => { rmSync(canon, { recursive: true, force: true }) })

describe('planClaudeRetrofit', () => {
  it('plans a skill, AGENTS.md, and CLAUDE.md', () => {
    const actions = planClaudeRetrofit(canon, '/target')
    const targets = actions.map(a => a.target)
    expect(targets).toContain('.claude/skills/tdd/SKILL.md')
    expect(targets).toContain('AGENTS.md')
    expect(targets).toContain('CLAUDE.md')
  })

  it('copies the canon skill content verbatim', () => {
    const action = planClaudeRetrofit(canon, '/target').find(a => a.target === '.claude/skills/tdd/SKILL.md')!
    expect(action.content).toContain('name: tdd')
  })

  it('CLAUDE.md imports AGENTS.md', () => {
    const action = planClaudeRetrofit(canon, '/target').find(a => a.target === 'CLAUDE.md')!
    expect(action.content).toContain('@AGENTS.md')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- retrofit/plan`
Expected: FAIL — cannot find module `src/retrofit/plan.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/retrofit/plan.ts`:
```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadManifest } from '../canon/manifest.js'

export interface Action {
  kind: 'write'
  target: string
  content: string
  reason: string
}

const CLAUDE_MD = `# Project Instructions

This project uses the Forge harness. Baseline instructions:

@AGENTS.md
`

export function planClaudeRetrofit(canonDir: string, _targetDir: string): Action[] {
  const manifest = loadManifest(join(canonDir, 'manifest.yaml'))
  const actions: Action[] = []

  for (const skill of manifest.skills) {
    const content = readFileSync(join(canonDir, skill.path, 'SKILL.md'), 'utf8')
    actions.push({
      kind: 'write',
      target: `.claude/skills/${skill.id}/SKILL.md`,
      content,
      reason: `skill: ${skill.id}`,
    })
  }

  actions.push({
    kind: 'write',
    target: 'AGENTS.md',
    content: readFileSync(join(canonDir, 'AGENTS.md'), 'utf8'),
    reason: 'baseline instructions',
  })

  actions.push({
    kind: 'write',
    target: 'CLAUDE.md',
    content: CLAUDE_MD,
    reason: 'Claude entry importing AGENTS.md',
  })

  return actions
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- retrofit/plan`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/retrofit/plan.ts tests/retrofit/plan.test.ts
git commit -m "feat: plan Claude retrofit actions from the canon"
```

---

### Task 4: Apply actions (non-destructive, idempotent)

**Files:**
- Create: `src/retrofit/apply.ts`
- Test: `tests/retrofit/apply.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/retrofit/apply.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { applyActions } from '../../src/retrofit/apply.js'
import type { Action } from '../../src/retrofit/plan.js'

let target: string
const backupDir = () => join(target, '.forge', 'backup', 'test')

const actions: Action[] = [
  { kind: 'write', target: 'AGENTS.md', content: 'NEW', reason: 'baseline' },
  { kind: 'write', target: '.claude/skills/tdd/SKILL.md', content: 'SKILL', reason: 'skill: tdd' },
]

beforeEach(() => { target = mkdtempSync(join(tmpdir(), 'forge-apply-')) })
afterEach(() => { rmSync(target, { recursive: true, force: true }) })

describe('applyActions', () => {
  it('creates new files', () => {
    const res = applyActions(actions, target, { backupDir: backupDir() })
    expect(res.every(r => r.status === 'created')).toBe(true)
    expect(readFileSync(join(target, 'AGENTS.md'), 'utf8')).toBe('NEW')
    expect(existsSync(join(target, '.claude/skills/tdd/SKILL.md'))).toBe(true)
  })

  it('is idempotent — second run reports unchanged and writes no backup', () => {
    applyActions(actions, target, { backupDir: backupDir() })
    const res = applyActions(actions, target, { backupDir: backupDir() })
    expect(res.every(r => r.status === 'unchanged')).toBe(true)
    expect(existsSync(backupDir())).toBe(false)
  })

  it('backs up an existing file before overwriting with different content', () => {
    writeFileSync(join(target, 'AGENTS.md'), 'OLD')
    const res = applyActions(actions, target, { backupDir: backupDir() })
    const agents = res.find(r => r.target === 'AGENTS.md')!
    expect(agents.status).toBe('overwritten')
    expect(agents.backedUp).toBeDefined()
    expect(readFileSync(agents.backedUp!, 'utf8')).toBe('OLD')
    expect(readFileSync(join(target, 'AGENTS.md'), 'utf8')).toBe('NEW')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- retrofit/apply`
Expected: FAIL — cannot find module `src/retrofit/apply.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/retrofit/apply.ts`:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { Action } from './plan.js'

export interface AppliedAction {
  target: string
  status: 'created' | 'overwritten' | 'unchanged'
  backedUp?: string
  reason: string
}

export interface ApplyOptions {
  backupDir: string
}

export function applyActions(actions: Action[], targetDir: string, opts: ApplyOptions): AppliedAction[] {
  const results: AppliedAction[] = []

  for (const action of actions) {
    const dest = join(targetDir, action.target)
    let status: AppliedAction['status']
    let backedUp: string | undefined

    if (existsSync(dest)) {
      const current = readFileSync(dest, 'utf8')
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

    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, action.content)
    results.push({ target: action.target, status, backedUp, reason: action.reason })
  }

  return results
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- retrofit/apply`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/retrofit/apply.ts tests/retrofit/apply.test.ts
git commit -m "feat: apply retrofit actions non-destructively with backups"
```

---

### Task 5: Report formatting

**Files:**
- Create: `src/retrofit/report.ts`
- Test: `tests/retrofit/report.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/retrofit/report.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { formatReport } from '../../src/retrofit/report.js'
import type { AppliedAction } from '../../src/retrofit/apply.js'

const applied: AppliedAction[] = [
  { target: 'AGENTS.md', status: 'created', reason: 'baseline' },
  { target: 'CLAUDE.md', status: 'overwritten', backedUp: '/b/CLAUDE.md', reason: 'entry' },
  { target: '.claude/skills/tdd/SKILL.md', status: 'unchanged', reason: 'skill: tdd' },
]

describe('formatReport', () => {
  it('summarizes counts and loop state', () => {
    const out = formatReport(applied, { loopEnabled: false })
    expect(out).toContain('1 created')
    expect(out).toContain('1 overwritten')
    expect(out).toContain('1 unchanged')
    expect(out).toContain('Loop: disabled')
  })

  it('lists each target with its status', () => {
    const out = formatReport(applied, { loopEnabled: true })
    expect(out).toContain('AGENTS.md')
    expect(out).toContain('Loop: enabled')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- retrofit/report`
Expected: FAIL — cannot find module `src/retrofit/report.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/retrofit/report.ts`:
```ts
import type { AppliedAction } from './apply.js'

export interface ReportMeta {
  loopEnabled: boolean
}

export function formatReport(applied: AppliedAction[], meta: ReportMeta): string {
  const count = (s: AppliedAction['status']) => applied.filter(a => a.status === s).length
  const lines: string[] = []
  lines.push('Forge retrofit (Claude Code):')
  for (const a of applied) {
    const note = a.backedUp ? ` (backup: ${a.backedUp})` : ''
    lines.push(`  ${a.status.padEnd(11)} ${a.target}${note}`)
  }
  lines.push('')
  lines.push(`Summary: ${count('created')} created, ${count('overwritten')} overwritten, ${count('unchanged')} unchanged`)
  lines.push(`Loop: ${meta.loopEnabled ? 'enabled' : 'disabled'}`)
  return lines.join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- retrofit/report`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/retrofit/report.ts tests/retrofit/report.test.ts
git commit -m "feat: format retrofit report"
```

---

### Task 6: Canon directory resolution

**Files:**
- Create: `src/retrofit/canon-dir.ts`
- Test: `tests/retrofit/canon-dir.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/retrofit/canon-dir.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveCanonDir } from '../../src/retrofit/canon-dir.js'

describe('resolveCanonDir', () => {
  it('finds the bundled canon (contains manifest.yaml)', () => {
    const dir = resolveCanonDir()
    expect(existsSync(join(dir, 'manifest.yaml'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- retrofit/canon-dir`
Expected: FAIL — cannot find module `src/retrofit/canon-dir.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/retrofit/canon-dir.ts`:
```ts
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Walk up from this module to the package root (the dir containing package.json),
// then return its `canon/` directory. Works under both tsx (src/) and built dist/.
export function resolveCanonDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'package.json'))) {
      return join(dir, 'canon')
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('could not locate package root to resolve canon/')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- retrofit/canon-dir`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/retrofit/canon-dir.ts tests/retrofit/canon-dir.test.ts
git commit -m "feat: resolve bundled canon directory"
```

---

### Task 7: Wire `forge retrofit` CLI + integration test

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/retrofit/retrofit.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/retrofit/retrofit.integration.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runRetrofit } from '../../src/cli.js'
import { loadConfig } from '../../src/retrofit/config.js'

let target: string
beforeEach(() => { target = mkdtempSync(join(tmpdir(), 'forge-retro-')) })
afterEach(() => { rmSync(target, { recursive: true, force: true }) })

describe('forge retrofit (integration, Claude)', () => {
  it('generates Claude artifacts and writes config with loop disabled by default', () => {
    const code = runRetrofit(target, { loop: false })
    expect(code).toBe(0)
    expect(existsSync(join(target, 'AGENTS.md'))).toBe(true)
    expect(existsSync(join(target, 'CLAUDE.md'))).toBe(true)
    expect(existsSync(join(target, '.claude/skills/tdd/SKILL.md'))).toBe(true)
    expect(existsSync(join(target, '.claude/skills/eng-review/SKILL.md'))).toBe(true)
    const cfg = loadConfig(target)!
    expect(cfg.agents).toContain('claude')
    expect(cfg.loop.enabled).toBe(false)
  })

  it('records loop enabled when --loop is passed', () => {
    runRetrofit(target, { loop: true })
    expect(loadConfig(target)!.loop.enabled).toBe(true)
  })

  it('is idempotent on a second run', () => {
    runRetrofit(target, { loop: false })
    const agentsBefore = readFileSync(join(target, 'AGENTS.md'), 'utf8')
    const code = runRetrofit(target, { loop: false })
    expect(code).toBe(0)
    expect(readFileSync(join(target, 'AGENTS.md'), 'utf8')).toBe(agentsBefore)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- retrofit.integration`
Expected: FAIL — `runRetrofit` is not exported from `src/cli.js`.

- [ ] **Step 3: Modify `src/cli.ts` to add `runRetrofit` and the subcommand**

Add these imports at the top of `src/cli.ts` (below the existing import):
```ts
import { resolveCanonDir } from './retrofit/canon-dir.js'
import { planClaudeRetrofit } from './retrofit/plan.js'
import { applyActions } from './retrofit/apply.js'
import { formatReport } from './retrofit/report.js'
import { loadConfig, saveConfig, defaultConfig, type ForgeConfig } from './retrofit/config.js'
import { loadManifest } from './canon/manifest.js'
import { join } from 'node:path'
```

Add the `runRetrofit` function (after `runValidate`):
```ts
export function runRetrofit(targetDir: string, opts: { loop: boolean }): number {
  const canonDir = resolveCanonDir()
  const canonVersion = loadManifest(join(canonDir, 'manifest.yaml')).version

  const actions = planClaudeRetrofit(canonDir, targetDir)
  const backupDir = join(targetDir, '.forge', 'backup', String(Date.now()))
  const applied = applyActions(actions, targetDir, { backupDir })

  const existing = loadConfig(targetDir)
  const config: ForgeConfig = {
    ...(existing ?? defaultConfig(canonVersion)),
    canonVersion,
    agents: ['claude'],
    loop: { enabled: opts.loop },
  }
  saveConfig(targetDir, config)

  console.log(formatReport(applied, { loopEnabled: config.loop.enabled }))
  return 0
}
```

Extend the `switch` in `main` with a `retrofit` case:
```ts
    case 'retrofit': {
      const targetDir = rest.find(a => !a.startsWith('-')) ?? '.'
      const loop = rest.includes('--loop')
      return runRetrofit(targetDir, { loop })
    }
```

And update the default usage line:
```ts
    default:
      console.log('usage: forge <validate [canonDir] | retrofit [targetDir] [--loop]>')
      return cmd ? 1 : 0
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- retrofit.integration`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite and a manual smoke**

Run: `npm test`
Expected: all tests pass (Baustein A's 17 + B1's new tests).

Run (PowerShell), retrofitting a throwaway dir:
```
mkdir ../forge-smoke 2>$null; npm run forge -- retrofit ../forge-smoke
```
Expected: prints the retrofit report; `../forge-smoke/.claude/skills/tdd/SKILL.md`, `AGENTS.md`, `CLAUDE.md`, and `.forge/config.yaml` exist. Then delete it: `Remove-Item -Recurse -Force ../forge-smoke`.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts tests/retrofit/retrofit.integration.test.ts
git commit -m "feat: wire forge retrofit command for Claude Code"
```

---

### Task 8: Retrofit skill wrapper (agent-facing)

**Files:**
- Create: `canon/skills/forge-retrofit/SKILL.md`
- Test: (validated by Baustein A's `real-canon` test — the new skill must be added to `canon/manifest.yaml`)

- [ ] **Step 1: Add the skill to `canon/manifest.yaml`**

Add under `skills:`:
```yaml
  - { id: forge-retrofit, path: skills/forge-retrofit, kind: methodology }
```

- [ ] **Step 2: Create `canon/skills/forge-retrofit/SKILL.md`**

```markdown
---
name: forge-retrofit
description: Use when asked to "retrofit", "forge this project", or set up the Forge harness in a project — runs forge retrofit and asks whether to enable the autonomous loop.
---

# Forge Retrofit

Set up (or update) the Forge harness in the current project.

1. Run `forge retrofit .` to generate the Claude Code artifacts (`.claude/skills/`, `AGENTS.md`, `CLAUDE.md`). This is non-destructive — existing files are backed up under `.forge/backup/` before any overwrite.
2. **Ask the user whether to enable the autonomous Loop** (default: off). If yes, re-run with `forge retrofit . --loop`. The choice is recorded in `.forge/config.yaml` and can be changed any time with `forge loop on|off` (Baustein C).
3. Show the user the printed report (what was created/overwritten/unchanged) and where backups went.

Never overwrite the user's existing instructions without surfacing the backup location in your summary.
```

- [ ] **Step 3: Run the canon validator and the real-canon test**

Run: `npm test -- real-canon`
Expected: PASS — the canon (now with `forge-retrofit`) still validates.

Run: `npm run forge -- validate canon`
Expected: `✓ canon valid (canon)`.

- [ ] **Step 4: Commit**

```bash
git add canon/manifest.yaml canon/skills/forge-retrofit/SKILL.md
git commit -m "feat: add agent-facing forge-retrofit skill to the canon"
```

---

## Self-Review

**1. Spec coverage (Baustein B1 scope):**
- detect → Task 2 ✓
- plan (non-destructive, additive) → Tasks 3, 4 (backup-before-overwrite) ✓
- generate Claude artifacts (.claude/skills, AGENTS.md, CLAUDE.md) → Tasks 3, 7 ✓
- report → Tasks 5, 7 ✓
- loop opt-in recorded in `.forge/config.yaml`, default off → Tasks 1, 7 ✓
- agent-facing skill that asks about the loop → Task 8 ✓
- idempotent + reversible (backups) → Tasks 4, 7 ✓
- (Deferred to B2: Codex/Gemini generation, rtk/graphify/playwright MCP wiring, rtk WSL detection. Correct — B1 is Claude-only.)

**2. Placeholder scan:** No TBD/TODO; every step has complete code/content. ✓

**3. Type consistency:** `Agent`, `ForgeConfig`, `Detection`, `Action{kind,target,content,reason}`, `AppliedAction{target,status,backedUp?,reason}`, `ReportMeta{loopEnabled}`, `planClaudeRetrofit`, `applyActions`, `formatReport`, `resolveCanonDir`, `runRetrofit`, `loadConfig/saveConfig/defaultConfig` — names and signatures consistent across tasks. `loadManifest`/`Manifest` reused from Baustein A unchanged. ✓

---

## Next Plans (not this document)

- **Plan B2 — Retrofit for Codex + Gemini + tool wiring:** generate `AGENTS.md`/`config.toml`/`RTK.md` (Codex) and `.gemini/commands/*.toml`/`GEMINI.md`/`settings.json` (Gemini); wire rtk (hook/instruction with WSL detection), graphify + Playwright MCP servers per agent.
- **Plan C — Loop-Engine:** Ralph driver, gates, worktree isolation, `forge loop on|off|status`.
