# Forge — Baustein B2 (Codex + Gemini retrofit + tool wiring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `forge retrofit` to generate idiomatic Codex CLI and Gemini CLI artifacts from the Canon, and wire the cross-agent tools (graphify + Playwright MCP for all three agents; rtk per agent with Windows WSL detection) — driven by an `--agent` selection.

**Architecture:** Replace the single `planClaudeRetrofit` call with a per-agent **planner registry** (`PLANNERS: Record<Agent, AgentPlanner>`). Each planner emits idiomatic `Action`s for its harness. A shared `tools` module produces the MCP/instruction wiring per agent so the three planners don't duplicate it. `runRetrofit` selects agents (`--agent`, or detected, or all) and records every applied agent additively in `.forge/config.yaml`. Apply/report/backup from B1 are reused unchanged. Baustein B2 of the Forge spec; loop hardening is C2.

**Tech Stack:** Node.js (ESM), TypeScript, vitest, `yaml`. Reuses B1: `Action`, `applyActions`, `formatReport`, `detectProject`, `ForgeConfig`, `resolveCanonDir`, `loadManifest`. The exact MCP launch commands are best-effort templates with honest inline comments; tests assert artifact STRUCTURE, not that external tools run.

**Builds on:** Baustein A+B1+C1 (on `main`). Key reuse: `src/retrofit/plan.ts` (`planClaudeRetrofit`, `Action`), `src/retrofit/apply.ts`, `src/retrofit/report.ts`, `src/retrofit/detect.ts`, `src/cli.ts` (`runRetrofit`).

---

## File Structure

```
src/retrofit/
  tools.ts                 # NEW: per-agent MCP server config + rtk wiring snippets (pure)
  wsl.ts                   # NEW: hasWsl() — Windows WSL availability probe
  planners/
    claude.ts              # NEW: planClaude() = B1 skills/AGENTS/CLAUDE + tool wiring (.mcp.json, rtk hook/instruction)
    codex.ts               # NEW: planCodex() = AGENTS.md + .codex/config.toml (MCP) + RTK.md
    gemini.ts              # NEW: planGemini() = GEMINI.md + .gemini/commands/*.toml + .gemini/settings.json + rtk instruction
  plan.ts                  # MODIFY: keep planClaudeRetrofit (delegates to planners/claude); add PLANNERS + planRetrofit()
  cli.ts (src/cli.ts)      # MODIFY: runRetrofit accepts agent selection; --agent flag
tests/retrofit/
  tools.test.ts            # NEW
  planners-codex.test.ts   # NEW
  planners-gemini.test.ts  # NEW
  plan-dispatch.test.ts    # NEW
  retrofit.integration.test.ts  # MODIFY: add multi-agent assertions
```

The planner registry is the single extension point: adding an agent later means one new `planners/*.ts` + one registry line.

---

### Task 1: Tool wiring module

**Files:**
- Create: `src/retrofit/tools.ts`
- Test: `tests/retrofit/tools.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/retrofit/tools.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mcpServers, rtkInstruction } from '../../src/retrofit/tools.js'

describe('tools', () => {
  it('mcpServers includes graphify and playwright with command+args', () => {
    const servers = mcpServers()
    expect(Object.keys(servers)).toEqual(expect.arrayContaining(['graphify', 'playwright']))
    expect(servers.playwright.command).toBe('npx')
    expect(servers.playwright.args).toContain('@playwright/mcp@latest')
    expect(servers.graphify.command).toBeTypeOf('string')
  })

  it('rtkInstruction mentions prefixing commands with rtk', () => {
    expect(rtkInstruction()).toMatch(/rtk/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- retrofit/tools`
Expected: FAIL — cannot find module `src/retrofit/tools.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/retrofit/tools.ts`:
```ts
export interface McpServerConfig {
  command: string
  args: string[]
}

// Best-effort default launch commands. Users may need to adjust these to match
// their local install (e.g. graphify installed via `uv tool install graphifyy`).
export function mcpServers(): Record<string, McpServerConfig> {
  return {
    graphify: { command: 'graphify', args: ['serve'] },
    playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
  }
}

// rtk has no transparent-rewrite hook on Codex/Gemini; those agents get this
// instruction instead. On Claude (Windows) it is also the WSL-less fallback.
export function rtkInstruction(): string {
  return [
    '## Token efficiency (rtk)',
    '',
    'Prefix shell/dev commands with `rtk` to compress their output before it enters context.',
    'Example: `rtk git status`, `rtk npm test`. See https://github.com/rtk-ai/rtk.',
  ].join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- retrofit/tools`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/retrofit/tools.ts tests/retrofit/tools.test.ts
git commit -m "feat: add per-agent MCP server + rtk wiring snippets"
```

---

### Task 2: WSL detection

**Files:**
- Create: `src/retrofit/wsl.ts`
- Test: `tests/retrofit/wsl.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/retrofit/wsl.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { hasWsl } from '../../src/retrofit/wsl.js'

describe('hasWsl', () => {
  it('returns a boolean and never throws', () => {
    expect(typeof hasWsl()).toBe('boolean')
  })

  it('is false on non-win32 platforms', () => {
    // hasWsl() short-circuits to false unless process.platform === 'win32'
    if (process.platform !== 'win32') {
      expect(hasWsl()).toBe(false)
    } else {
      expect(typeof hasWsl()).toBe('boolean')
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- retrofit/wsl`
Expected: FAIL — cannot find module `src/retrofit/wsl.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/retrofit/wsl.ts`:
```ts
import { execFileSync } from 'node:child_process'

// True only on Windows where a WSL distribution responds. Used to decide whether
// rtk can use its transparent PreToolUse hook (needs WSL) or must fall back to
// instruction mode. Never throws.
export function hasWsl(): boolean {
  if (process.platform !== 'win32') return false
  try {
    execFileSync('wsl', ['--status'], { stdio: 'pipe', timeout: 5000 })
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- retrofit/wsl`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/retrofit/wsl.ts tests/retrofit/wsl.test.ts
git commit -m "feat: add WSL availability probe for rtk hook fallback"
```

---

### Task 3: Claude planner (extract B1 + add tool wiring)

**Files:**
- Create: `src/retrofit/planners/claude.ts`
- Test: `tests/retrofit/planners-claude.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/retrofit/planners-claude.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planClaude } from '../../src/retrofit/planners/claude.js'

let canon: string
beforeEach(() => {
  canon = mkdtempSync(join(tmpdir(), 'forge-canon-'))
  const w = (rel: string, c: string) => { mkdirSync(join(canon, rel, '..'), { recursive: true }); writeFileSync(join(canon, rel), c) }
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
  w('AGENTS.md', '# Baseline\n')
  w('skills/tdd/SKILL.md', '---\nname: tdd\ndescription: d\n---\nbody')
})
afterEach(() => { rmSync(canon, { recursive: true, force: true }) })

describe('planClaude', () => {
  it('plans skill, AGENTS.md, CLAUDE.md and an .mcp.json with both servers', () => {
    const targets = planClaude(canon, '/t').map(a => a.target)
    expect(targets).toContain('.claude/skills/tdd/SKILL.md')
    expect(targets).toContain('AGENTS.md')
    expect(targets).toContain('CLAUDE.md')
    expect(targets).toContain('.mcp.json')
  })

  it('the .mcp.json content references graphify and playwright', () => {
    const mcp = planClaude(canon, '/t').find(a => a.target === '.mcp.json')!
    expect(mcp.content).toContain('graphify')
    expect(mcp.content).toContain('playwright')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- planners-claude`
Expected: FAIL — cannot find module `src/retrofit/planners/claude.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/retrofit/planners/claude.ts`:
```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadManifest } from '../../canon/manifest.js'
import type { Action } from '../plan.js'
import { mcpServers, rtkInstruction } from '../tools.js'
import { hasWsl } from '../wsl.js'

const claudeMd = (rtkNote: string) => `# Project Instructions

This project uses the Forge harness. Baseline instructions:

@AGENTS.md
${rtkNote ? `\n${rtkNote}\n` : ''}`

export function planClaude(canonDir: string, _targetDir: string): Action[] {
  const manifest = loadManifest(join(canonDir, 'manifest.yaml'))
  const actions: Action[] = []

  for (const skill of manifest.skills) {
    actions.push({
      kind: 'write',
      target: `.claude/skills/${skill.id}/SKILL.md`,
      content: readFileSync(join(canonDir, skill.path, 'SKILL.md'), 'utf8'),
      reason: `skill: ${skill.id}`,
    })
  }

  actions.push({
    kind: 'write',
    target: 'AGENTS.md',
    content: readFileSync(join(canonDir, 'AGENTS.md'), 'utf8'),
    reason: 'baseline instructions',
  })

  // rtk: PreToolUse hook needs WSL on Windows; otherwise fall back to instruction mode.
  const rtkHookable = hasWsl()
  actions.push({
    kind: 'write',
    target: 'CLAUDE.md',
    content: claudeMd(rtkHookable ? '' : rtkInstruction()),
    reason: 'Claude entry importing AGENTS.md',
  })

  actions.push({
    kind: 'write',
    target: '.mcp.json',
    content: JSON.stringify({ mcpServers: mcpServers() }, null, 2) + '\n',
    reason: 'MCP servers (graphify, playwright)',
  })

  if (rtkHookable) {
    actions.push({
      kind: 'write',
      target: '.claude/settings.json',
      content: JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook' }] }],
        },
      }, null, 2) + '\n',
      reason: 'rtk PreToolUse hook (WSL detected)',
    })
  }

  return actions
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- planners-claude`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/retrofit/planners/claude.ts tests/retrofit/planners-claude.test.ts
git commit -m "feat: add claude planner with MCP + rtk wiring"
```

---

### Task 4: Codex planner

**Files:**
- Create: `src/retrofit/planners/codex.ts`
- Test: `tests/retrofit/planners-codex.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/retrofit/planners-codex.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planCodex } from '../../src/retrofit/planners/codex.js'

let canon: string
beforeEach(() => {
  canon = mkdtempSync(join(tmpdir(), 'forge-canon-'))
  const w = (rel: string, c: string) => { mkdirSync(join(canon, rel, '..'), { recursive: true }); writeFileSync(join(canon, rel), c) }
  w('manifest.yaml', `
name: forge-canon
version: 0.1.0
agents: [codex]
skills: []
policy: []
loop: { spec: loop/loop-spec.md, prdSchema: loop/prd.schema.md }
tools: []
`)
  w('AGENTS.md', '# Baseline\n')
})
afterEach(() => { rmSync(canon, { recursive: true, force: true }) })

describe('planCodex', () => {
  it('plans AGENTS.md, .codex/config.toml, and RTK.md', () => {
    const targets = planCodex(canon, '/t').map(a => a.target)
    expect(targets).toContain('AGENTS.md')
    expect(targets).toContain('.codex/config.toml')
    expect(targets).toContain('RTK.md')
  })

  it('config.toml has [mcp_servers.graphify] and [mcp_servers.playwright]', () => {
    const toml = planCodex(canon, '/t').find(a => a.target === '.codex/config.toml')!
    expect(toml.content).toContain('[mcp_servers.graphify]')
    expect(toml.content).toContain('[mcp_servers.playwright]')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- planners-codex`
Expected: FAIL — cannot find module `src/retrofit/planners/codex.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/retrofit/planners/codex.ts`:
```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Action } from '../plan.js'
import { mcpServers, rtkInstruction } from '../tools.js'

function tomlMcp(): string {
  const servers = mcpServers()
  // Codex reads MCP servers from ~/.codex/config.toml. This project-level file is a
  // ready-to-merge snippet; users append these blocks to their global config.
  return Object.entries(servers)
    .map(([name, cfg]) => {
      const args = cfg.args.map(a => `"${a}"`).join(', ')
      return `[mcp_servers.${name}]\ncommand = "${cfg.command}"\nargs = [${args}]\n`
    })
    .join('\n')
}

export function planCodex(canonDir: string, _targetDir: string): Action[] {
  return [
    {
      kind: 'write',
      target: 'AGENTS.md',
      content: readFileSync(join(canonDir, 'AGENTS.md'), 'utf8'),
      reason: 'baseline instructions (Codex reads AGENTS.md natively)',
    },
    {
      kind: 'write',
      target: '.codex/config.toml',
      content: `# Forge: MCP servers for Codex. Merge into ~/.codex/config.toml.\n\n${tomlMcp()}`,
      reason: 'MCP servers (graphify, playwright)',
    },
    {
      kind: 'write',
      target: 'RTK.md',
      content: rtkInstruction() + '\n',
      reason: 'rtk instruction (Codex has no rewrite hook)',
    },
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- planners-codex`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/retrofit/planners/codex.ts tests/retrofit/planners-codex.test.ts
git commit -m "feat: add codex planner (AGENTS.md, config.toml MCP, RTK.md)"
```

---

### Task 5: Gemini planner

**Files:**
- Create: `src/retrofit/planners/gemini.ts`
- Test: `tests/retrofit/planners-gemini.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/retrofit/planners-gemini.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse } from 'yaml'
import { planGemini } from '../../src/retrofit/planners/gemini.js'

let canon: string
beforeEach(() => {
  canon = mkdtempSync(join(tmpdir(), 'forge-canon-'))
  const w = (rel: string, c: string) => { mkdirSync(join(canon, rel, '..'), { recursive: true }); writeFileSync(join(canon, rel), c) }
  w('manifest.yaml', `
name: forge-canon
version: 0.1.0
agents: [gemini]
skills:
  - { id: tdd, path: skills/tdd, kind: methodology }
policy: []
loop: { spec: loop/loop-spec.md, prdSchema: loop/prd.schema.md }
tools: []
`)
  w('AGENTS.md', '# Baseline\n')
  w('skills/tdd/SKILL.md', '---\nname: tdd\ndescription: Test-driven development\n---\nbody')
})
afterEach(() => { rmSync(canon, { recursive: true, force: true }) })

describe('planGemini', () => {
  it('plans GEMINI.md, a command toml per skill, and settings.json', () => {
    const targets = planGemini(canon, '/t').map(a => a.target)
    expect(targets).toContain('GEMINI.md')
    expect(targets).toContain('.gemini/commands/tdd.toml')
    expect(targets).toContain('.gemini/settings.json')
  })

  it('settings.json wires mcpServers and AGENTS.md context', () => {
    const s = planGemini(canon, '/t').find(a => a.target === '.gemini/settings.json')!
    const cfg = JSON.parse(s.content)
    expect(Object.keys(cfg.mcpServers)).toContain('graphify')
    expect(cfg.context.fileName).toContain('AGENTS.md')
  })

  it('a command toml carries description and prompt', () => {
    const cmd = planGemini(canon, '/t').find(a => a.target === '.gemini/commands/tdd.toml')!
    expect(cmd.content).toContain('description')
    expect(cmd.content).toContain('prompt')
    expect(cmd.content).toContain('Test-driven development')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- planners-gemini`
Expected: FAIL — cannot find module `src/retrofit/planners/gemini.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/retrofit/planners/gemini.ts`:
```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { loadManifest } from '../../canon/manifest.js'
import { parseFrontmatter } from '../../canon/frontmatter.js'
import type { Action } from '../plan.js'
import { mcpServers, rtkInstruction } from '../tools.js'

function tomlString(s: string): string {
  return '"""\n' + s.replace(/"""/g, '\\"\\"\\"') + '\n"""'
}

export function planGemini(canonDir: string, _targetDir: string): Action[] {
  const manifest = loadManifest(join(canonDir, 'manifest.yaml'))
  const actions: Action[] = []

  // GEMINI.md: baseline + rtk instruction (Gemini has no rewrite hook).
  const baseline = readFileSync(join(canonDir, 'AGENTS.md'), 'utf8')
  actions.push({
    kind: 'write',
    target: 'GEMINI.md',
    content: `${baseline}\n${rtkInstruction()}\n`,
    reason: 'baseline + rtk instruction (no hook on Gemini)',
  })

  // One TOML slash command per skill.
  for (const skill of manifest.skills) {
    const body = readFileSync(join(canonDir, skill.path, 'SKILL.md'), 'utf8')
    const fm = parseFrontmatter(body) ?? {}
    const description = String(fm.description ?? skill.id)
    const prompt = `You are using the "${skill.id}" skill.\n\n${description}\n\nFollow it for the current task.`
    actions.push({
      kind: 'write',
      target: `.gemini/commands/${skill.id}.toml`,
      content: `description = "${description.replace(/"/g, '\\"')}"\nprompt = ${tomlString(prompt)}\n`,
      reason: `gemini command: ${skill.id}`,
    })
  }

  // settings.json: MCP servers + read AGENTS.md as context.
  actions.push({
    kind: 'write',
    target: '.gemini/settings.json',
    content: JSON.stringify({
      mcpServers: mcpServers(),
      context: { fileName: ['AGENTS.md', 'GEMINI.md'] },
    }, null, 2) + '\n',
    reason: 'MCP servers + AGENTS.md context',
  })

  // Also ship AGENTS.md so the context.fileName entry resolves.
  actions.push({
    kind: 'write',
    target: 'AGENTS.md',
    content: baseline,
    reason: 'baseline instructions (shared)',
  })

  return actions
}
```

Note: `stringify` from `yaml` is imported for parity with other planners but TOML is hand-built here; if your linter flags the unused import, remove it. (Keep `parse`-free.) The `tomlString` helper uses TOML multi-line basic strings.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- planners-gemini`
Expected: PASS (3 tests). If the unused `stringify` import causes a TS/lint error, delete that import line.

- [ ] **Step 5: Commit**

```bash
git add src/retrofit/planners/gemini.ts tests/retrofit/planners-gemini.test.ts
git commit -m "feat: add gemini planner (GEMINI.md, command toml, settings.json)"
```

---

### Task 6: Planner registry + dispatch

**Files:**
- Modify: `src/retrofit/plan.ts`
- Test: `tests/retrofit/plan-dispatch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/retrofit/plan-dispatch.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planRetrofit } from '../../src/retrofit/plan.js'

let canon: string
beforeEach(() => {
  canon = mkdtempSync(join(tmpdir(), 'forge-canon-'))
  const w = (rel: string, c: string) => { mkdirSync(join(canon, rel, '..'), { recursive: true }); writeFileSync(join(canon, rel), c) }
  w('manifest.yaml', `
name: forge-canon
version: 0.1.0
agents: [claude, codex, gemini]
skills:
  - { id: tdd, path: skills/tdd, kind: methodology }
policy: []
loop: { spec: loop/loop-spec.md, prdSchema: loop/prd.schema.md }
tools: []
`)
  w('AGENTS.md', '# Baseline\n')
  w('skills/tdd/SKILL.md', '---\nname: tdd\ndescription: d\n---\nbody')
})
afterEach(() => { rmSync(canon, { recursive: true, force: true }) })

describe('planRetrofit', () => {
  it('dispatches to one planner', () => {
    const targets = planRetrofit(canon, '/t', ['codex']).map(a => a.target)
    expect(targets).toContain('.codex/config.toml')
    expect(targets).not.toContain('.claude/skills/tdd/SKILL.md')
  })

  it('merges multiple agents and de-dupes shared targets (AGENTS.md once)', () => {
    const actions = planRetrofit(canon, '/t', ['claude', 'codex', 'gemini'])
    const targets = actions.map(a => a.target)
    expect(targets).toContain('.claude/skills/tdd/SKILL.md')
    expect(targets).toContain('.codex/config.toml')
    expect(targets).toContain('.gemini/commands/tdd.toml')
    expect(targets.filter(t => t === 'AGENTS.md')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- plan-dispatch`
Expected: FAIL — `planRetrofit` is not exported.

- [ ] **Step 3: Modify `src/retrofit/plan.ts`**

Keep the `Action` interface and `planClaudeRetrofit` (used by B1 tests). Add imports at the top:
```ts
import { planClaude } from './planners/claude.js'
import { planCodex } from './planners/codex.js'
import { planGemini } from './planners/gemini.js'
import type { Agent } from './config.js'
```

Re-point `planClaudeRetrofit` to the new planner (replace its body) so there is one source of truth:
```ts
export function planClaudeRetrofit(canonDir: string, targetDir: string): Action[] {
  return planClaude(canonDir, targetDir)
}
```

Add the registry + dispatcher at the end of the file:
```ts
export type AgentPlanner = (canonDir: string, targetDir: string) => Action[]

export const PLANNERS: Record<Agent, AgentPlanner> = {
  claude: planClaude,
  codex: planCodex,
  gemini: planGemini,
}

export function planRetrofit(canonDir: string, targetDir: string, agents: Agent[]): Action[] {
  const seen = new Set<string>()
  const merged: Action[] = []
  for (const agent of agents) {
    for (const action of PLANNERS[agent](canonDir, targetDir)) {
      if (seen.has(action.target)) continue
      seen.add(action.target)
      merged.push(action)
    }
  }
  return merged
}
```

Note: the original B1 `planClaudeRetrofit` body (the inline skill/AGENTS/CLAUDE logic) is now superseded by `planClaude` in Task 3, which is a superset (adds `.mcp.json`). The B1 `plan.test.ts` assertions (skill, AGENTS.md, CLAUDE.md, `@AGENTS.md`) still hold because `planClaude` emits all of those. Run `npm test -- retrofit/plan` to confirm B1's plan test still passes after the re-point.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- plan-dispatch retrofit/plan`
Expected: PASS — both the new dispatch tests and B1's original plan tests.

- [ ] **Step 5: Commit**

```bash
git add src/retrofit/plan.ts tests/retrofit/plan-dispatch.test.ts
git commit -m "feat: add planner registry and multi-agent planRetrofit dispatch"
```

---

### Task 7: CLI agent selection + multi-agent retrofit

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/retrofit/retrofit.integration.test.ts` (extend)

- [ ] **Step 1: Add failing multi-agent integration tests**

Append to `tests/retrofit/retrofit.integration.test.ts` (inside the existing `describe`):
```ts
  it('retrofits all three agents when --agent all is selected', () => {
    const code = runRetrofit(target, { loop: false, agents: ['claude', 'codex', 'gemini'] })
    expect(code).toBe(0)
    expect(existsSync(join(target, '.claude/skills/tdd/SKILL.md'))).toBe(true)
    expect(existsSync(join(target, '.codex/config.toml'))).toBe(true)
    expect(existsSync(join(target, '.gemini/settings.json'))).toBe(true)
    const cfg = loadConfig(target)!
    expect(cfg.agents).toEqual(expect.arrayContaining(['claude', 'codex', 'gemini']))
  })

  it('retrofits only the selected agent', () => {
    runRetrofit(target, { loop: false, agents: ['gemini'] })
    expect(existsSync(join(target, '.gemini/settings.json'))).toBe(true)
    expect(existsSync(join(target, '.codex/config.toml'))).toBe(false)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- retrofit.integration`
Expected: FAIL — `runRetrofit` does not accept an `agents` option yet (type error / undefined behavior).

- [ ] **Step 3: Modify `src/cli.ts` `runRetrofit`**

Replace the imports line for plan to use the dispatcher:
```ts
import { planRetrofit } from './retrofit/plan.js'
import type { Agent } from './retrofit/config.js'
```
(remove the now-unused `planClaudeRetrofit` import if present).

Change the `runRetrofit` signature and body:
```ts
export function runRetrofit(targetDir: string, opts: { loop: boolean; agents?: Agent[] }): number {
  const canonDir = resolveCanonDir()
  const canonVersion = loadManifest(join(canonDir, 'manifest.yaml')).version

  const detection = detectProject(targetDir)
  const agents: Agent[] = opts.agents && opts.agents.length > 0
    ? opts.agents
    : (detection.agents.length > 0 ? detection.agents : ['claude'])

  const actions = planRetrofit(canonDir, targetDir, agents)
  const backupDir = join(targetDir, '.forge', 'backup', String(Date.now()))
  const applied = applyActions(actions, targetDir, { backupDir })

  const existing = loadConfig(targetDir)
  const priorAgents = existing?.agents ?? []
  const mergedAgents = [...new Set([...priorAgents, ...agents])]
  const config: ForgeConfig = {
    ...(existing ?? defaultConfig(canonVersion)),
    canonVersion,
    agents: mergedAgents,
    loop: { enabled: opts.loop },
  }
  saveConfig(targetDir, config)

  console.log(formatReport(applied, { loopEnabled: config.loop.enabled, detectedAgents: detection.agents }))
  return 0
}
```
(Ensure `detectProject` is imported — it was added in B1's fix. Keep that import.)

Update the `retrofit` case in `main` to parse `--agent`:
```ts
    case 'retrofit': {
      const targetDir = rest.find(a => !a.startsWith('-')) ?? '.'
      const loop = rest.includes('--loop')
      const agentArg = rest.find(a => a.startsWith('--agent='))?.slice('--agent='.length)
      const all: Agent[] = ['claude', 'codex', 'gemini']
      const agents = !agentArg || agentArg === 'all'
        ? (agentArg === 'all' ? all : undefined)
        : agentArg.split(',').filter((a): a is Agent => (all as string[]).includes(a))
      return runRetrofit(targetDir, { loop, agents })
    }
```

Update the default usage line:
```ts
    default:
      console.log('usage: forge <validate [canonDir] | retrofit [targetDir] [--agent=claude,codex,gemini|all] [--loop] | loop <on|off|status|run>>')
      return cmd ? 1 : 0
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- retrofit.integration`
Expected: PASS (the existing B1 integration tests + the two new multi-agent tests).

- [ ] **Step 5: Run the full suite + smoke**

Run: `npm test`
Expected: all tests pass.

Run (PowerShell):
```
mkdir ../forge-smoke2 2>$null; npm run forge -- retrofit ../forge-smoke2 --agent=all
```
Expected: report lists created files; `../forge-smoke2` contains `.claude/`, `.codex/config.toml`, `.gemini/settings.json`, `AGENTS.md`, `.forge/config.yaml`. Clean up: `Remove-Item -Recurse -Force ../forge-smoke2`.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts tests/retrofit/retrofit.integration.test.ts
git commit -m "feat: forge retrofit --agent selection with multi-agent generation"
```

---

### Task 8: Update the retrofit skill + canon tool docs

**Files:**
- Modify: `canon/skills/forge-retrofit/SKILL.md`

- [ ] **Step 1: Update `canon/skills/forge-retrofit/SKILL.md`**

Replace the numbered list step 1 and add an agent note. New content:
```markdown
---
name: forge-retrofit
description: Use when asked to "retrofit", "forge this project", or set up the Forge harness in a project — runs forge retrofit and asks whether to enable the autonomous loop.
---

# Forge Retrofit

Set up (or update) the Forge harness in the current project.

1. Run `forge retrofit .` to generate artifacts for the agents detected in the project, or `forge retrofit . --agent=all` for Claude + Codex + Gemini. This is non-destructive — existing files are backed up under `.forge/backup/` before any overwrite. Generated per agent:
   - Claude: `.claude/skills/`, `AGENTS.md`, `CLAUDE.md`, `.mcp.json` (+ rtk hook when WSL is available).
   - Codex: `AGENTS.md`, `.codex/config.toml` (MCP), `RTK.md`.
   - Gemini: `GEMINI.md`, `.gemini/commands/*.toml`, `.gemini/settings.json`.
2. **Ask the user whether to enable the autonomous Loop** (default off). If yes, add `--loop`. Recorded in `.forge/config.yaml`; toggle any time with `forge loop on|off`.
3. Show the printed report (created/overwritten/unchanged + detected agents) and where backups went. Note that MCP launch commands in the generated configs may need adjusting to the user's local tool installs.
```

- [ ] **Step 2: Validate the canon**

Run: `npm run forge -- validate canon`
Expected: `✓ canon valid (canon)`.

Run: `npm test -- real-canon`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add canon/skills/forge-retrofit/SKILL.md
git commit -m "docs: document multi-agent retrofit in the forge-retrofit skill"
```

---

## Self-Review

**1. Spec coverage (Baustein B2 scope):**
- Codex artifact generation (AGENTS.md, config.toml MCP, RTK.md) → Task 4 ✓
- Gemini artifact generation (GEMINI.md, command TOML, settings.json, AGENTS.md context) → Task 5 ✓
- Tool wiring: graphify + Playwright MCP per agent → Tasks 1, 3, 4, 5 ✓
- rtk per agent; Claude hook with WSL detection + instruction fallback → Tasks 1, 2, 3 ✓
- Gemini asymmetry (no hook → instruction) → Tasks 1, 5 ✓
- Per-agent planner registry + `--agent` selection, additive agent recording → Tasks 6, 7 ✓
- Non-destructive/idempotent (reuses B1 apply) → Task 7 ✓
- (Honest limitation, documented: exact MCP launch commands are best-effort templates; Codex project-vs-global config noted inline. C2 unaffected.)

**2. Placeholder scan:** No TBD/TODO. The "remove the unused import if your linter flags it" note in Task 5 is a conditional instruction, not a placeholder — the import is optional. Every code step is complete.

**3. Type consistency:** `Action`, `Agent`, `McpServerConfig`, `mcpServers()`, `rtkInstruction()`, `hasWsl()`, `planClaude`/`planCodex`/`planGemini`, `AgentPlanner`, `PLANNERS`, `planRetrofit`, `runRetrofit({loop,agents?})`, `formatReport(...,{loopEnabled,detectedAgents})` — consistent. `planClaudeRetrofit` retained as a thin delegate so B1's `plan.test.ts` stays green. Config merge uses the additive pattern established in B1. ✓

---

## Next Plans (not this document)

- **Plan C2 — Loop hardening:** independent test run (replace exit-code trust), per-iteration git-worktree isolation, Codex/Gemini runners, review-iteration with role separation, tool-surface-readiness gate.
- **Optional B3 — polish:** real per-tool install checks, Codex global-config merge helper, Serena swap option.
