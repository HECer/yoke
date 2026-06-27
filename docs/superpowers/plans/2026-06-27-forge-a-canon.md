# Forge — Baustein A (Canon + Validator) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the harness-agnostic Canon (source-of-truth) and a `forge validate` CLI that lints the Canon for integrity, fully TDD'd.

**Architecture:** A Node.js/TypeScript CLI (`forge`) with a `validate` subcommand. It loads `canon/manifest.yaml` (zod-validated), then checks that every referenced skill/policy/loop/tool path exists and that each `SKILL.md` has valid frontmatter. The Canon itself is seeded with minimal-but-real content that passes validation. This is Baustein A of the Forge spec (`docs/superpowers/specs/2026-06-27-forge-cross-agent-harness-design.md`); B (Retrofit-Skill) and C (Loop) get their own plans.

**Tech Stack:** Node.js (ESM), TypeScript, vitest (test), `yaml` + `zod` (parsing/schema). Distribution via `npx`/`package.json` `bin`.

---

## File Structure

```
package.json              # project + forge bin + scripts
tsconfig.json             # TS config (ESM, strict)
vitest.config.ts          # test config
.gitignore                # node_modules, dist
src/
  cli.ts                  # entry: dispatch subcommands (validate)
  canon/
    manifest.ts           # zod schema + loadManifest()
    frontmatter.ts        # parseFrontmatter() for SKILL.md
    validate.ts           # validateCanon() -> Issue[]
canon/                    # THE CANON (source-of-truth, harness-agnostic)
  AGENTS.md
  manifest.yaml
  skills/tdd/SKILL.md
  skills/eng-review/SKILL.md
  policy/gates.md
  policy/roles.md
  loop/loop-spec.md
  loop/prd.schema.md
  tools/rtk.md
  tools/graphify.md
  tools/playwright-mcp.md
tests/
  canon/frontmatter.test.ts
  canon/manifest.test.ts
  canon/validate.test.ts
  canon/real-canon.test.ts
```

Each `src/canon/*.ts` file has one responsibility: schema, frontmatter parsing, validation orchestration. The CLI stays thin so logic is unit-testable without spawning processes.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Test: `tests/smoke.test.ts`

- [ ] **Step 1: Write the failing smoke test**

Create `tests/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "forge",
  "version": "0.1.0",
  "type": "module",
  "bin": { "forge": "./dist/cli.js" },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "forge": "tsx src/cli.ts"
  },
  "dependencies": {
    "yaml": "^2.5.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
})
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
dist/
*.log
```

- [ ] **Step 6: Install and run the test**

Run: `npm install && npm test`
Expected: 1 passing test (`smoke > runs`).

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore tests/smoke.test.ts
git commit -m "chore: scaffold forge TS project with vitest"
```

---

### Task 2: SKILL.md frontmatter parser

**Files:**
- Create: `src/canon/frontmatter.ts`
- Test: `tests/canon/frontmatter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/canon/frontmatter.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseFrontmatter } from '../../src/canon/frontmatter.js'

describe('parseFrontmatter', () => {
  it('parses name and description from a --- block', () => {
    const md = '---\nname: tdd\ndescription: Test-driven development\n---\n# Body\n'
    expect(parseFrontmatter(md)).toMatchObject({ name: 'tdd', description: 'Test-driven development' })
  })

  it('tolerates CRLF line endings', () => {
    const md = '---\r\nname: x\r\ndescription: y\r\n---\r\nbody'
    expect(parseFrontmatter(md)).toMatchObject({ name: 'x', description: 'y' })
  })

  it('returns null when there is no frontmatter', () => {
    expect(parseFrontmatter('# just a heading\n')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- frontmatter`
Expected: FAIL — cannot find module `src/canon/frontmatter.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/canon/frontmatter.ts`:
```ts
import { parse } from 'yaml'

export function parseFrontmatter(content: string): Record<string, unknown> | null {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return null
  const parsed = parse(m[1])
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- frontmatter`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/canon/frontmatter.ts tests/canon/frontmatter.test.ts
git commit -m "feat: add SKILL.md frontmatter parser"
```

---

### Task 3: Manifest schema + loader

**Files:**
- Create: `src/canon/manifest.ts`
- Test: `tests/canon/manifest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/canon/manifest.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadManifest } from '../../src/canon/manifest.js'

function withManifest(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-mani-'))
  writeFileSync(join(dir, 'manifest.yaml'), yaml)
  return join(dir, 'manifest.yaml')
}

describe('loadManifest', () => {
  it('parses a valid manifest', () => {
    const file = withManifest(`
name: forge-canon
version: 0.1.0
agents: [claude, codex, gemini]
skills:
  - { id: tdd, path: skills/tdd, kind: methodology }
policy:
  - { path: policy/gates.md }
loop: { spec: loop/loop-spec.md, prdSchema: loop/prd.schema.md }
tools:
  - { id: rtk, path: tools/rtk.md }
`)
    const m = loadManifest(file)
    expect(m.name).toBe('forge-canon')
    expect(m.agents).toEqual(['claude', 'codex', 'gemini'])
    expect(m.skills[0]).toMatchObject({ id: 'tdd', kind: 'methodology' })
    rmSync(join(file, '..'), { recursive: true, force: true })
  })

  it('rejects an unknown agent', () => {
    const file = withManifest(`
name: x
version: 0.1.0
agents: [claude, mystery]
skills: []
policy: []
loop: { spec: a, prdSchema: b }
tools: []
`)
    expect(() => loadManifest(file)).toThrow()
    rmSync(join(file, '..'), { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- manifest`
Expected: FAIL — cannot find module `src/canon/manifest.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/canon/manifest.ts`:
```ts
import { z } from 'zod'
import { parse } from 'yaml'
import { readFileSync } from 'node:fs'

export const AgentSchema = z.enum(['claude', 'codex', 'gemini'])

export const SkillEntrySchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  kind: z.enum(['methodology', 'role']),
})

export const ToolEntrySchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
})

export const ManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  agents: z.array(AgentSchema).min(1),
  skills: z.array(SkillEntrySchema),
  policy: z.array(z.object({ path: z.string().min(1) })),
  loop: z.object({ spec: z.string().min(1), prdSchema: z.string().min(1) }),
  tools: z.array(ToolEntrySchema),
})

export type Manifest = z.infer<typeof ManifestSchema>

export function loadManifest(file: string): Manifest {
  const raw = parse(readFileSync(file, 'utf8'))
  return ManifestSchema.parse(raw)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- manifest`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/canon/manifest.ts tests/canon/manifest.test.ts
git commit -m "feat: add canon manifest schema and loader"
```

---

### Task 4: Validator core

**Files:**
- Create: `src/canon/validate.ts`
- Test: `tests/canon/validate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/canon/validate.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validateCanon } from '../../src/canon/validate.js'

let dir: string

function write(rel: string, content: string) {
  const full = join(dir, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

function seedValidCanon() {
  write('manifest.yaml', `
name: c
version: 0.1.0
agents: [claude]
skills:
  - { id: tdd, path: skills/tdd, kind: methodology }
policy:
  - { path: policy/gates.md }
loop: { spec: loop/loop-spec.md, prdSchema: loop/prd.schema.md }
tools:
  - { id: rtk, path: tools/rtk.md }
`)
  write('skills/tdd/SKILL.md', '---\nname: tdd\ndescription: d\n---\nbody')
  write('policy/gates.md', 'gates')
  write('loop/loop-spec.md', 'loop')
  write('loop/prd.schema.md', 'prd')
  write('tools/rtk.md', 'rtk')
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'forge-canon-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('validateCanon', () => {
  it('returns no errors for a well-formed canon', () => {
    seedValidCanon()
    const errors = validateCanon(dir).filter(i => i.level === 'error')
    expect(errors).toEqual([])
  })

  it('flags a missing manifest', () => {
    const issues = validateCanon(dir)
    expect(issues.some(i => i.message.includes('manifest.yaml not found'))).toBe(true)
  })

  it('flags a skill whose SKILL.md is missing', () => {
    seedValidCanon()
    rmSync(join(dir, 'skills/tdd/SKILL.md'))
    expect(validateCanon(dir).some(i => i.message.includes('SKILL.md missing'))).toBe(true)
  })

  it('flags a skill with no frontmatter name', () => {
    seedValidCanon()
    write('skills/tdd/SKILL.md', '---\ndescription: d\n---\nbody')
    expect(validateCanon(dir).some(i => i.message.includes('missing name'))).toBe(true)
  })

  it('flags a missing policy file', () => {
    seedValidCanon()
    rmSync(join(dir, 'policy/gates.md'))
    expect(validateCanon(dir).some(i => i.message.includes('policy file not found'))).toBe(true)
  })

  it('flags duplicate skill ids', () => {
    seedValidCanon()
    write('manifest.yaml', `
name: c
version: 0.1.0
agents: [claude]
skills:
  - { id: tdd, path: skills/tdd, kind: methodology }
  - { id: tdd, path: skills/tdd, kind: role }
policy:
  - { path: policy/gates.md }
loop: { spec: loop/loop-spec.md, prdSchema: loop/prd.schema.md }
tools:
  - { id: rtk, path: tools/rtk.md }
`)
    expect(validateCanon(dir).some(i => i.message.includes('duplicate skill id'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- validate`
Expected: FAIL — cannot find module `src/canon/validate.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/canon/validate.ts`:
```ts
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { loadManifest } from './manifest.js'
import { parseFrontmatter } from './frontmatter.js'

export interface Issue {
  level: 'error' | 'warn'
  message: string
}

export function validateCanon(canonDir: string): Issue[] {
  const issues: Issue[] = []
  const manifestPath = join(canonDir, 'manifest.yaml')
  if (!existsSync(manifestPath)) {
    return [{ level: 'error', message: `manifest.yaml not found in ${canonDir}` }]
  }

  let manifest
  try {
    manifest = loadManifest(manifestPath)
  } catch (e) {
    return [{ level: 'error', message: `manifest.yaml invalid: ${(e as Error).message}` }]
  }

  const seenSkill = new Set<string>()
  for (const s of manifest.skills) {
    if (seenSkill.has(s.id)) issues.push({ level: 'error', message: `duplicate skill id: ${s.id}` })
    seenSkill.add(s.id)
    const dir = join(canonDir, s.path)
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      issues.push({ level: 'error', message: `skill ${s.id}: path not found: ${s.path}` })
      continue
    }
    const skillMd = join(dir, 'SKILL.md')
    if (!existsSync(skillMd)) {
      issues.push({ level: 'error', message: `skill ${s.id}: SKILL.md missing` })
      continue
    }
    const fm = parseFrontmatter(readFileSync(skillMd, 'utf8'))
    if (!fm) {
      issues.push({ level: 'error', message: `skill ${s.id}: SKILL.md has no frontmatter` })
    } else {
      if (!fm.name) issues.push({ level: 'error', message: `skill ${s.id}: frontmatter missing name` })
      if (!fm.description) issues.push({ level: 'error', message: `skill ${s.id}: frontmatter missing description` })
    }
  }

  for (const p of manifest.policy) {
    if (!existsSync(join(canonDir, p.path))) {
      issues.push({ level: 'error', message: `policy file not found: ${p.path}` })
    }
  }

  const loopChecks: ReadonlyArray<readonly [string, string]> = [
    ['loop.spec', manifest.loop.spec],
    ['loop.prdSchema', manifest.loop.prdSchema],
  ]
  for (const [label, rel] of loopChecks) {
    if (!existsSync(join(canonDir, rel))) {
      issues.push({ level: 'error', message: `${label} not found: ${rel}` })
    }
  }

  const seenTool = new Set<string>()
  for (const t of manifest.tools) {
    if (seenTool.has(t.id)) issues.push({ level: 'error', message: `duplicate tool id: ${t.id}` })
    seenTool.add(t.id)
    if (!existsSync(join(canonDir, t.path))) {
      issues.push({ level: 'error', message: `tool ${t.id}: path not found: ${t.path}` })
    }
  }

  return issues
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- validate`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/canon/validate.ts tests/canon/validate.test.ts
git commit -m "feat: add canon validator"
```

---

### Task 5: CLI wiring (`forge validate`)

**Files:**
- Create: `src/cli.ts`

- [ ] **Step 1: Write the implementation**

Create `src/cli.ts`:
```ts
#!/usr/bin/env node
import { validateCanon } from './canon/validate.js'

export function runValidate(canonDir: string): number {
  const issues = validateCanon(canonDir)
  for (const i of issues) {
    console.log(`${i.level === 'error' ? 'ERROR' : 'warn '} ${i.message}`)
  }
  const errors = issues.filter(i => i.level === 'error')
  if (errors.length === 0) {
    console.log(`✓ canon valid (${canonDir})`)
    return 0
  }
  console.log(`✗ ${errors.length} error(s)`)
  return 1
}

function main(argv: string[]): number {
  const [cmd, ...rest] = argv
  switch (cmd) {
    case 'validate':
      return runValidate(rest[0] ?? 'canon')
    default:
      console.log('usage: forge validate [canonDir]')
      return cmd ? 1 : 0
  }
}

process.exit(main(process.argv.slice(2)))
```

- [ ] **Step 2: Verify the CLI runs against a temp canon**

Run (PowerShell):
```
npm run forge -- validate canon
```
Expected: prints errors (canon not seeded yet) and exits non-zero. This confirms the command is wired; Task 6 seeds the real canon so it passes.

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: wire forge validate CLI command"
```

---

### Task 6: Seed the real Canon

**Files:**
- Create: `canon/AGENTS.md`, `canon/manifest.yaml`, `canon/skills/tdd/SKILL.md`, `canon/skills/eng-review/SKILL.md`, `canon/policy/gates.md`, `canon/policy/roles.md`, `canon/loop/loop-spec.md`, `canon/loop/prd.schema.md`, `canon/tools/rtk.md`, `canon/tools/graphify.md`, `canon/tools/playwright-mcp.md`
- Test: `tests/canon/real-canon.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/canon/real-canon.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { validateCanon } from '../../src/canon/validate.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

describe('real canon', () => {
  it('validates with zero errors', () => {
    const errors = validateCanon(join(repoRoot, 'canon')).filter(i => i.level === 'error')
    expect(errors).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- real-canon`
Expected: FAIL — `manifest.yaml not found in .../canon`.

- [ ] **Step 3: Create `canon/manifest.yaml`**

```yaml
name: forge-canon
version: 0.1.0
agents: [claude, codex, gemini]
skills:
  - { id: tdd, path: skills/tdd, kind: methodology }
  - { id: eng-review, path: skills/eng-review, kind: role }
policy:
  - { path: policy/gates.md }
  - { path: policy/roles.md }
loop:
  spec: loop/loop-spec.md
  prdSchema: loop/prd.schema.md
tools:
  - { id: rtk, path: tools/rtk.md }
  - { id: graphify, path: tools/graphify.md }
  - { id: playwright-mcp, path: tools/playwright-mcp.md }
```

- [ ] **Step 4: Create `canon/AGENTS.md`**

```markdown
# Forge Harness — Agent Baseline

You are operating in a project retrofitted by Forge. Follow these always:

- **Quality first:** Test-driven development is the default. No production code without a failing test first. See skill `tdd`.
- **Stop-the-Line:** Do not start implementation until Definition of Done / Acceptance Criteria are written. See `policy/gates.md`.
- **Role separation:** The agent that implements does not self-review, self-merge, or self-audit security. See `policy/roles.md`.
- **Context efficiency:** Prefer the wired tools (rtk for command output, the code-graph for symbol lookup) over reading whole files. See `tools/`.

This file is the portable baseline. Agent-specific instructions are generated alongside it (CLAUDE.md, GEMINI.md).
```

- [ ] **Step 5: Create `canon/skills/tdd/SKILL.md`**

```markdown
---
name: tdd
description: Use when writing any production code — enforces RED-GREEN-REFACTOR, no production code without a failing test first.
---

# Test-Driven Development

The Iron Law: **No production code without a failing test first.**

1. **RED** — write the smallest failing test for the next behavior. Run it; confirm it fails for the right reason.
2. **GREEN** — write the minimal code to make it pass. Run it; confirm it passes.
3. **REFACTOR** — clean up without changing behavior. Tests stay green.
4. **COMMIT** — one behavior per commit.

Never write multiple tests ahead of implementation. Never skip the failing-run step.
```

- [ ] **Step 6: Create `canon/skills/eng-review/SKILL.md`**

```markdown
---
name: eng-review
description: Use before merging a change — engineering-manager review of architecture, edge cases, test coverage, and performance.
---

# Engineering Review

Review a change for: architecture fit, data flow, edge cases, test coverage, and performance. Be opinionated. Block on:

- Missing or weak tests for the changed behavior.
- Unhandled error paths or edge cases.
- Architectural drift from the project's established patterns.

Output: a pass/block verdict with specific, actionable findings. A reviewer never reviews their own implementation (see `policy/roles.md`).
```

- [ ] **Step 7: Create `canon/policy/gates.md`**

```markdown
# Stop-the-Line Gates

These gates are enforced mechanically by the Loop (Baustein C) and expected of every agent run.

- **DoD gate:** Implementation may not begin until Definition of Done / Acceptance Criteria for the unit of work exist and are recorded (e.g., in the PRD story).
- **Green-tests gate:** A unit of work is not complete until its tests pass.
- **Clean-worktree gate:** No dispatch into a dirty or conflicted git worktree.
```

- [ ] **Step 8: Create `canon/policy/roles.md`**

```markdown
# Role Separation

The agent that performs a role must not also perform a conflicting one:

- **Implementer ≠ Reviewer** — implementation is not self-reviewed.
- **Implementer ≠ Merger** — the implementer does not merge their own change.
- **Implementer ≠ Security auditor** — security is not self-audited.

In the Loop, these map to separate iterations with fresh context.
```

- [ ] **Step 9: Create `canon/loop/loop-spec.md`**

```markdown
# Loop Specification (Ralph + GSD)

The autonomous loop is OPTIONAL and toggle-able (`forge loop on|off`). When enabled:

1. Pre-dispatch gates: missing tools / dirty worktree / git conflict → `blocked`.
2. Pick the highest-priority unfinished PRD story.
3. Stop-the-Line gate: DoD/AC present, else `blocked`.
4. Spawn a fresh agent (claude -p | codex exec | gemini) in a git worktree.
5. Implement ONE story → tests green → review iteration (different role).
6. Update the PRD (`passes: true`) + atomic commit.
7. Stop when all stories `passes: true`, or the iteration cap is reached.

State lives outside the model context: the PRD file + git. Full driver is built in Baustein C.
```

- [ ] **Step 10: Create `canon/loop/prd.schema.md`**

```markdown
# PRD Schema

The loop is driven by a versioned PRD file. Each story:

```yaml
- id: STORY-1
  title: Short imperative description
  priority: 1            # lower = higher priority
  acceptance:            # Definition of Done (required before implementation)
    - The endpoint returns 200 for a valid request.
  passes: false          # set true only when acceptance is met and tests are green
```

Stop condition: every story has `passes: true`.
```

- [ ] **Step 11: Create `canon/tools/rtk.md`**

```markdown
# Tool: rtk (token compression)

Per-agent wiring (generated by Baustein B):

- **Claude Code:** PreToolUse hook auto-rewrites commands (`git status` → `rtk git status`). On Windows this needs WSL; otherwise fall back to instruction mode (this file injected into CLAUDE.md telling the agent to prefix commands with `rtk`).
- **Codex CLI:** inject `RTK.md` / AGENTS.md instruction.
- **Gemini CLI:** no hook system — register rtk as an MCP tool or inject the GEMINI.md instruction.
```

- [ ] **Step 12: Create `canon/tools/graphify.md`**

```markdown
# Tool: graphify (code-graph)

MIT, multimodal code/doc graph. Wired as an MCP server for all three agents (stdio). Prefer symbol/graph lookups over reading whole files. Caveat: heuristic edges (INFERRED/AMBIGUOUS) and a static index that can go stale — rebuild on significant changes.
```

- [ ] **Step 13: Create `canon/tools/playwright-mcp.md`**

```markdown
# Tool: Playwright MCP (browser / dogfooding)

Microsoft Playwright MCP, Apache-2.0. Wired as an MCP server for all three agents — the only browser tool with native MCP parity across Claude/Codex/Gemini. Used for QA, dogfooding user flows, screenshots, and deploy verification.
```

- [ ] **Step 14: Run the integration test**

Run: `npm test -- real-canon`
Expected: PASS — the real canon validates with zero errors.

- [ ] **Step 15: Run the full suite and the CLI**

Run: `npm test`
Expected: all tests pass.

Run (PowerShell): `npm run forge -- validate canon`
Expected: `✓ canon valid (canon)` and exit 0.

- [ ] **Step 16: Commit**

```bash
git add canon tests/canon/real-canon.test.ts
git commit -m "feat: seed harness-agnostic canon and validate it"
```

---

## Self-Review

**1. Spec coverage (Baustein A scope):**
- Canon structure (skills/policy/loop/tools/AGENTS.md/manifest) → Task 6 ✓
- Manifest as source-of-truth declaration → Tasks 3, 6 ✓
- Harness-agnostic (no agent paths in canon) → Task 6 content ✓
- Independently testable software (`forge validate`) → Tasks 2–5 ✓
- Windows-native, no Make → Node/npm scripts only ✓
- (Deferred to Plan B: runtime generation/detect/wire. Deferred to Plan C: loop driver. Correct — A is content + validator only.)

**2. Placeholder scan:** No TBD/TODO; every file has complete content; every code step shows full code. ✓

**3. Type consistency:** `Issue{level,message}`, `Manifest`, `loadManifest()`, `parseFrontmatter()`, `validateCanon()`, `runValidate()` — names used consistently across tasks. Manifest YAML field names (`skills/policy/loop/tools`, `loop.spec`, `loop.prdSchema`, skill `kind`) match between schema (Task 3) and seed (Task 6). ✓

---

## Next Plans (not this document)

- **Plan B — Retrofit-Skill:** `forge detect|plan|generate|wire|report`, runtime artifact generation per agent, non-destructive, asks about loop opt-in.
- **Plan C — Loop-Engine:** the Ralph driver, gates, worktree isolation, `forge loop on|off|status`.
