# Forge — Baustein D (code-graph choice + minimal-code skill) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Make the retrofit's code-graph tool a per-project **choice** — Serena (LSP-accurate) or graphify (fast/multimodal) — selectable via `--code-graph`, recorded in config, with the `forge-retrofit` skill instructing the agent to ask the user and recommend based on the project. (2) Add a Forge-native `minimal-code` canon skill (the YAGNI "lazy senior dev" idea, adapted from the MIT-licensed ponytail ruleset) that flows to all three agents and saves output tokens by writing less code.

**Architecture:** A `CodeGraph` type (`graphify | serena`) is added to config and threaded through `planRetrofit` → planners → `mcpServers(codeGraph)`, so the generated MCP config wires the chosen graph tool. The choice is resolved (flag > existing config > default `graphify`) and persisted. `minimal-code` is just a new canon skill — the existing planners already generate skills to every agent, so adding it to the manifest propagates it everywhere. Baustein D.

**Tech Stack:** Node.js (ESM), TypeScript, vitest. Touches config, tools, planners, plan dispatch, cli, and canon content.

**Builds on:** all prior bausteine on `main`. Modifies: `src/retrofit/config.ts`, `src/retrofit/tools.ts`, `src/retrofit/planners/{claude,codex,gemini}.ts`, `src/retrofit/plan.ts`, `src/cli.ts`, `canon/manifest.yaml`, `canon/skills/forge-retrofit/SKILL.md`; adds `canon/skills/minimal-code/SKILL.md`, `canon/tools/serena.md`.

---

## File Structure

```
src/retrofit/config.ts        # CodeGraph type + ForgeConfig.codeGraph? + schema
src/retrofit/tools.ts         # mcpServers(codeGraph) + serena server entry
src/retrofit/planners/*.ts    # thread codeGraph into mcpServers calls
src/retrofit/plan.ts          # planRetrofit(..., codeGraph); AgentPlanner gains codeGraph
src/cli.ts                    # runRetrofit resolves+records codeGraph; --code-graph flag
canon/manifest.yaml           # + minimal-code skill, + serena tool
canon/skills/minimal-code/SKILL.md   # NEW (ponytail-derived)
canon/tools/serena.md                # NEW
canon/skills/forge-retrofit/SKILL.md # MODIFY (ask code-graph + recommend)
```

---

### Task 1: CodeGraph type + config field

**Files:**
- Modify: `src/retrofit/config.ts`
- Test: `tests/retrofit/config.test.ts` (extend)

- [ ] **Step 1: Add a failing test**

In `tests/retrofit/config.test.ts`, add:
```ts
  it('round-trips an optional codeGraph choice', () => {
    const cfg = { canonVersion: '0.1.0', agents: ['claude'] as const, loop: { enabled: false }, codeGraph: 'serena' as const }
    saveConfig(dir, cfg)
    expect(loadConfig(dir)).toEqual(cfg)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- retrofit/config`
Expected: FAIL — zod strips/ rejects unknown `codeGraph`, so the round-trip is not equal.

- [ ] **Step 3: Modify `src/retrofit/config.ts`**

Add the type (next to `Agent`):
```ts
export type CodeGraph = 'graphify' | 'serena'
```
Add the schema enum (next to `AgentSchema`):
```ts
const CodeGraphSchema = z.enum(['graphify', 'serena'])
```
Add `codeGraph` to the zod object (optional) and to the interface:
```ts
const ForgeConfigSchema = z.object({
  canonVersion: z.string().min(1),
  agents: z.array(AgentSchema),
  loop: z.object({ enabled: z.boolean() }),
  verify: z.object({ command: z.string().min(1) }).optional(),
  codeGraph: CodeGraphSchema.optional(),
})

export interface ForgeConfig {
  canonVersion: string
  agents: Agent[]
  loop: { enabled: boolean }
  verify?: { command: string }
  codeGraph?: CodeGraph
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- retrofit/config`
Expected: PASS (existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add src/retrofit/config.ts tests/retrofit/config.test.ts
git commit -m "feat: add optional codeGraph choice to config"
```

---

### Task 2: Selectable code-graph MCP server

**Files:**
- Modify: `src/retrofit/tools.ts`
- Test: `tests/retrofit/tools.test.ts` (extend)

- [ ] **Step 1: Update the tests**

In `tests/retrofit/tools.test.ts`, replace the existing `mcpServers` test with parameterized ones:
```ts
  it('mcpServers defaults to graphify + playwright', () => {
    const servers = mcpServers()
    expect(Object.keys(servers)).toEqual(expect.arrayContaining(['graphify', 'playwright']))
    expect(servers).not.toHaveProperty('serena')
    expect(servers.playwright.command).toBe('npx')
    expect(servers.playwright.args).toContain('@playwright/mcp@latest')
  })

  it('mcpServers("serena") wires serena instead of graphify', () => {
    const servers = mcpServers('serena')
    expect(Object.keys(servers)).toEqual(expect.arrayContaining(['serena', 'playwright']))
    expect(servers).not.toHaveProperty('graphify')
    expect(servers.serena.command).toBeTypeOf('string')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- retrofit/tools`
Expected: FAIL — `mcpServers` takes no arg and always returns graphify.

- [ ] **Step 3: Modify `src/retrofit/tools.ts`**

Add the import and a code-graph server map, and parameterize `mcpServers`:
```ts
import type { CodeGraph } from './config.js'

export interface McpServerConfig {
  command: string
  args: string[]
}

// Best-effort launch commands per code-graph tool. Users may need to adjust these
// to match their local install (graphify: `uv tool install graphifyy`; serena: `uv`,
// e.g. `uvx --from git+https://github.com/oraios/serena serena-mcp-server`).
const CODE_GRAPH_SERVERS: Record<CodeGraph, McpServerConfig> = {
  graphify: { command: 'graphify', args: ['serve'] },
  serena: { command: 'serena', args: ['start-mcp-server'] },
}

export function mcpServers(codeGraph: CodeGraph = 'graphify'): Record<string, McpServerConfig> {
  return {
    [codeGraph]: CODE_GRAPH_SERVERS[codeGraph],
    playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
  }
}
```
(Leave `rtkInstruction` unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- retrofit/tools`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/retrofit/tools.ts tests/retrofit/tools.test.ts
git commit -m "feat: select code-graph MCP server (graphify or serena)"
```

---

### Task 3: Thread codeGraph through planners and dispatch

**Files:**
- Modify: `src/retrofit/planners/claude.ts`, `src/retrofit/planners/codex.ts`, `src/retrofit/planners/gemini.ts`, `src/retrofit/plan.ts`
- Test: `tests/retrofit/planners-claude.test.ts`, `tests/retrofit/plan-dispatch.test.ts` (extend)

- [ ] **Step 1: Add failing tests**

In `tests/retrofit/planners-claude.test.ts`, add:
```ts
  it('wires the chosen code-graph into .mcp.json', () => {
    const mcp = planClaude(canon, '/t', false, 'serena').find(a => a.target === '.mcp.json')!
    expect(mcp.content).toContain('serena')
    expect(mcp.content).not.toContain('graphify')
  })
```
In `tests/retrofit/plan-dispatch.test.ts`, add:
```ts
  it('passes the code-graph choice to every planner', () => {
    const actions = planRetrofit(canon, '/t', ['claude', 'codex', 'gemini'], 'serena')
    const claudeMcp = actions.find(a => a.target === '.mcp.json')!
    const codexToml = actions.find(a => a.target === '.codex/config.toml')!
    const geminiSettings = actions.find(a => a.target === '.gemini/settings.json')!
    expect(claudeMcp.content).toContain('serena')
    expect(codexToml.content).toContain('mcp_servers.serena')
    expect(geminiSettings.content).toContain('serena')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- planners-claude plan-dispatch`
Expected: FAIL — planners don't accept/forward a code-graph choice.

- [ ] **Step 3: Modify the three planners to accept `codeGraph`**

In `src/retrofit/planners/claude.ts`: import the type and add a 4th param after `wslAvailable`, and pass it to `mcpServers`:
```ts
import type { Action } from '../plan.js'
import type { CodeGraph } from '../config.js'
import { mcpServers, rtkInstruction } from '../tools.js'
import { hasWsl } from '../wsl.js'
// ...
export function planClaude(canonDir: string, _targetDir: string, wslAvailable: boolean = hasWsl(), codeGraph: CodeGraph = 'graphify'): Action[] {
```
and change the `.mcp.json` action to `content: JSON.stringify({ mcpServers: mcpServers(codeGraph) }, null, 2) + '\n'` and its `reason` to `'MCP servers (code-graph + playwright)'`.

In `src/retrofit/planners/codex.ts`: thread `codeGraph` into `tomlMcp`:
```ts
import type { CodeGraph } from '../config.js'
// ...
function tomlMcp(codeGraph: CodeGraph): string {
  const servers = mcpServers(codeGraph)
  // ... unchanged body ...
}

export function planCodex(canonDir: string, _targetDir: string, codeGraph: CodeGraph = 'graphify'): Action[] {
  return [
    // AGENTS.md action unchanged
    {
      kind: 'write',
      target: '.codex/config.toml',
      content: `# Forge: MCP servers for Codex. Merge into ~/.codex/config.toml.\n\n${tomlMcp(codeGraph)}`,
      reason: 'MCP servers (code-graph + playwright)',
    },
    // RTK.md action unchanged
  ]
}
```

In `src/retrofit/planners/gemini.ts`: add the param and pass to `mcpServers`:
```ts
import type { CodeGraph } from '../config.js'
// ...
export function planGemini(canonDir: string, _targetDir: string, codeGraph: CodeGraph = 'graphify'): Action[] {
```
and change the `.gemini/settings.json` action to use `mcpServers: mcpServers(codeGraph)`.

- [ ] **Step 4: Modify `src/retrofit/plan.ts` dispatch**

Update the `AgentPlanner` type, registry (claude needs an adapter because its 3rd param is `wslAvailable`), and `planRetrofit`:
```ts
import { planClaude } from './planners/claude.js'
import { planCodex } from './planners/codex.js'
import { planGemini } from './planners/gemini.js'
import type { Agent, CodeGraph } from './config.js'

// ... Action interface unchanged ...

export function planClaudeRetrofit(canonDir: string, targetDir: string): Action[] {
  return planClaude(canonDir, targetDir)
}

export type AgentPlanner = (canonDir: string, targetDir: string, codeGraph: CodeGraph) => Action[]

export const PLANNERS: Record<Agent, AgentPlanner> = {
  claude: (c, t, cg) => planClaude(c, t, undefined, cg),
  codex: planCodex,
  gemini: planGemini,
}

export function planRetrofit(canonDir: string, targetDir: string, agents: Agent[], codeGraph: CodeGraph = 'graphify'): Action[] {
  const seen = new Set<string>()
  const merged: Action[] = []
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
Note: `planClaude(c, t, undefined, cg)` passes `undefined` for `wslAvailable`, which triggers its `= hasWsl()` default — so existing `planClaude(canon, '/t', true|false)` test calls are unaffected.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- planners-claude plan-dispatch retrofit/plan`
Expected: PASS — new code-graph tests and the existing B1/B2/C3 planner tests (which don't pass a code-graph and default to graphify).

- [ ] **Step 6: Commit**

```bash
git add src/retrofit/planners/ src/retrofit/plan.ts tests/retrofit/planners-claude.test.ts tests/retrofit/plan-dispatch.test.ts
git commit -m "feat: thread code-graph choice through planners and dispatch"
```

---

### Task 4: Resolve + record code-graph in runRetrofit; --code-graph flag

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/retrofit/retrofit.integration.test.ts` (extend)

- [ ] **Step 1: Add failing tests**

Append to `tests/retrofit/retrofit.integration.test.ts` (inside the existing describe; `runRetrofit` and `loadConfig` are already imported):
```ts
  it('defaults codeGraph to graphify and records it', () => {
    runRetrofit(target, { loop: false, agents: ['claude'] })
    expect(loadConfig(target)!.codeGraph).toBe('graphify')
  })

  it('honors an explicit codeGraph and persists it', () => {
    runRetrofit(target, { loop: false, agents: ['claude'], codeGraph: 'serena' })
    expect(loadConfig(target)!.codeGraph).toBe('serena')
    expect(existsSync(join(target, '.mcp.json'))).toBe(true)
  })

  it('keeps a previously-chosen codeGraph on a later run that does not specify one', () => {
    runRetrofit(target, { loop: false, agents: ['claude'], codeGraph: 'serena' })
    runRetrofit(target, { loop: false, agents: ['claude'] })
    expect(loadConfig(target)!.codeGraph).toBe('serena')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- retrofit.integration`
Expected: FAIL — `runRetrofit` does not accept/record `codeGraph`.

- [ ] **Step 3: Modify `src/cli.ts` `runRetrofit`**

Add the `CodeGraph` type to the config import:
```ts
import { loadConfig, saveConfig, defaultConfig, type ForgeConfig, type CodeGraph } from './retrofit/config.js'
```
Change the signature and body to resolve + thread + record the code-graph (flag > existing config > default graphify):
```ts
export function runRetrofit(targetDir: string, opts: { loop: boolean; agents?: Agent[]; codeGraph?: CodeGraph }): number {
  const canonDir = resolveCanonDir()
  const canonVersion = loadManifest(join(canonDir, 'manifest.yaml')).version

  const detection = detectProject(targetDir)
  const agents: Agent[] = opts.agents && opts.agents.length > 0
    ? opts.agents
    : (detection.agents.length > 0 ? detection.agents : ['claude'])

  const existing = loadConfig(targetDir)
  const codeGraph: CodeGraph = opts.codeGraph ?? existing?.codeGraph ?? 'graphify'

  const actions = planRetrofit(canonDir, targetDir, agents, codeGraph)
  const backupDir = join(targetDir, '.forge', 'backup', String(Date.now()))
  const applied = applyActions(actions, targetDir, { backupDir })

  const priorAgents = existing?.agents ?? []
  const mergedAgents = [...new Set([...priorAgents, ...agents])]
  const config: ForgeConfig = {
    ...(existing ?? defaultConfig(canonVersion)),
    canonVersion,
    agents: mergedAgents,
    loop: { enabled: opts.loop },
    codeGraph,
  }
  saveConfig(targetDir, config)

  console.log(formatReport(applied, { loopEnabled: config.loop.enabled, detectedAgents: detection.agents }))
  return 0
}
```

- [ ] **Step 4: Parse `--code-graph=` in the retrofit CLI branch**

In `main`'s `retrofit` case, after parsing `agents`, add:
```ts
      const cgArg = rest.find(a => a.startsWith('--code-graph='))?.slice('--code-graph='.length)
      const codeGraph = cgArg === 'serena' || cgArg === 'graphify' ? cgArg : undefined
      if (cgArg && !codeGraph) {
        console.error(`Invalid --code-graph value: ${cgArg} (expected graphify|serena)`)
        return 1
      }
      return runRetrofit(targetDir, { loop, agents, codeGraph })
```
(Replace the existing `return runRetrofit(targetDir, { loop, agents })` line.) Update the `default` usage line to include the flag:
```ts
      console.log('usage: forge <validate [canonDir] | retrofit [targetDir] [--agent=claude,codex,gemini|all] [--code-graph=graphify|serena] [--loop] | loop <on|off|status|run>>')
```

- [ ] **Step 5: Run test to verify it passes + build**

Run: `npm test -- retrofit.integration`
Expected: PASS (existing + 3 new).

Run: `npm run build`
Expected: tsc 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts tests/retrofit/retrofit.integration.test.ts
git commit -m "feat: resolve and persist code-graph choice; --code-graph flag"
```

---

### Task 5: Canon content — minimal-code skill, serena doc, retrofit-skill guidance

**Files:**
- Create: `canon/skills/minimal-code/SKILL.md`, `canon/tools/serena.md`
- Modify: `canon/manifest.yaml`, `canon/skills/forge-retrofit/SKILL.md`
- Test: `tests/canon/real-canon.test.ts` (already validates the whole canon)

- [ ] **Step 1: Add the new canon entries to `canon/manifest.yaml`**

Under `skills:` add:
```yaml
  - { id: minimal-code, path: skills/minimal-code, kind: methodology }
```
Under `tools:` add:
```yaml
  - { id: serena, path: tools/serena.md }
```

- [ ] **Step 2: Create `canon/skills/minimal-code/SKILL.md`**

```markdown
---
name: minimal-code
description: Use before writing any code — write the least code that fully solves the task (YAGNI, stdlib-first, no unrequested abstractions) to save tokens and reduce maintenance.
---

# Minimal Code (lazy senior dev)

The best code is the code you never wrote. Before writing anything, walk this ladder and stop at the first rung that solves the task:

1. **Does it already exist?** Reuse an existing function, file, or builtin before writing new code.
2. **Can the language/stdlib do it?** Prefer the standard library and built-in platform features over a dependency or a hand-rolled version.
3. **Is the abstraction requested?** Do not add layers, config, interfaces, or generality nobody asked for. Solve the concrete case.
4. **Is it the shortest correct version?** Prefer deletion over addition, boring over clever, one obvious path over branching flexibility.
5. **Did the task actually ask for this?** Build only what was requested — no speculative features (YAGNI).

Rules:
- Deletion over addition. Boring over clever. No abstractions that were not requested.
- Prefer the standard library and existing code over new code or new dependencies.
- Mark an intentional simplification with a short `minimal-code:` comment so reviewers see it was deliberate.

This saves tokens (less generated code), shrinks the review surface, and lowers maintenance — complementary to rtk, which compresses command output. Adapted from the MIT-licensed "ponytail" ruleset (github.com/DietrichGebert/ponytail).
```

- [ ] **Step 3: Create `canon/tools/serena.md`**

```markdown
# Tool: Serena (code-graph, LSP-accurate)

MIT, MCP-first. The alternative to graphify, selected via `forge retrofit --code-graph=serena`. Serena uses real language servers (LSP) for symbol-accurate, cross-file retrieval and refactoring (`find_symbol`, `find_referencing_symbols`, rename/move) — no static index that goes stale, so it will not miss a reference.

Wired as an MCP server for all three agents. Best for large, strongly-typed codebases (TypeScript, Python, Go) doing systematic refactoring, where missing a caller is costly.

Caveat: needs one language server per language (can be fiddly on Windows for exotic languages) and requires `uv`. The launch command is a best-effort template — adjust to your install, e.g. `uvx --from git+https://github.com/oraios/serena serena-mcp-server`.
```

- [ ] **Step 4: Update `canon/skills/forge-retrofit/SKILL.md`**

Replace its body with guidance that adds the code-graph question and the minimal-code mention:
```markdown
---
name: forge-retrofit
description: Use when asked to "retrofit", "forge this project", or set up the Forge harness in a project — runs forge retrofit, picks a code-graph tool, and asks whether to enable the autonomous loop.
---

# Forge Retrofit

Set up (or update) the Forge harness in the current project.

1. **Choose the code-graph tool.** Ask the user which to wire, and recommend based on the project:
   - **Serena** (LSP-accurate, symbol-exact refactoring, no stale index) — recommend for large, strongly-typed codebases (TypeScript, Python, Go) doing systematic refactoring, where missing a reference is costly. Needs one language server per language.
   - **graphify** (fast, multimodal: code + PDFs + diagrams + images; ~70x token reduction on large mixed repos; honest INFERRED/AMBIGUOUS edges) — recommend for rapid exploration / migration / onboarding of large or unfamiliar repos, or repos with mixed non-code content.
   Make a direct recommendation for THIS project, then run with `--code-graph=serena` or `--code-graph=graphify` (default graphify if the user has no preference). The choice is saved in `.forge/config.yaml`.
2. Run `forge retrofit . --agent=all --code-graph=<choice>` (or a subset of agents). Non-destructive — existing files are backed up under `.forge/backup/` before any overwrite; `.claude/settings.json` is merged, not replaced. Generated per agent: Claude (`.claude/skills/`, `AGENTS.md`, `CLAUDE.md`, `.mcp.json`, rtk hook when WSL is available); Codex (`AGENTS.md`, `.codex/config.toml`, `RTK.md`); Gemini (`GEMINI.md`, `.gemini/commands/*.toml`, `.gemini/settings.json`).
3. **Ask whether to enable the autonomous Loop** (default off). If yes, add `--loop`. Toggle any time with `forge loop on|off`.
4. Show the printed report (created/overwritten/unchanged/merged + detected agents) and where backups went. Note that the generated MCP launch commands may need adjusting to the user's local tool installs.

The harness includes a `minimal-code` skill (YAGNI / lazy-senior-dev) that nudges every agent to write the least code that solves the task — saving tokens and reducing maintenance.
```

- [ ] **Step 5: Validate the canon + full suite + build**

Run: `npm run forge -- validate canon`
Expected: `✓ canon valid (canon)`.

Run: `npm test`
Expected: all pass (real-canon now validates the canon with `minimal-code` + `serena`).

Run: `npm run build`
Expected: tsc 0 errors.

- [ ] **Step 6: Commit**

```bash
git add canon/manifest.yaml canon/skills/minimal-code canon/tools/serena.md canon/skills/forge-retrofit/SKILL.md
git commit -m "feat: add minimal-code skill and serena tool; retrofit asks code-graph"
```

---

## Self-Review

**1. Spec coverage (Baustein D):**
- Code-graph is a per-project choice (graphify | serena) → Tasks 1–4 ✓
- Selectable via `--code-graph`, recorded in `.forge/config.yaml`, default graphify, sticky across runs → Task 4 ✓
- Wired into the generated MCP config for all three agents → Tasks 2, 3 ✓
- forge-retrofit skill asks the user + recommends per project → Task 5 ✓
- minimal-code (ponytail-derived, credited) canon skill flows to all agents → Task 5 ✓
- serena documented in the canon → Task 5 ✓

**2. Placeholder scan:** No TBD/TODO. MCP launch commands are explicitly labelled best-effort templates (honest, not placeholders). Every step has complete code/content.

**3. Type consistency:** `CodeGraph` defined once in config.ts and imported by tools/planners/plan/cli. `mcpServers(codeGraph='graphify')`. Planner signatures: `planClaude(c,t,wslAvailable?,codeGraph?)`, `planCodex(c,t,codeGraph?)`, `planGemini(c,t,codeGraph?)`; `AgentPlanner=(c,t,codeGraph)=>Action[]` with a claude adapter passing `undefined` for wslAvailable (so existing C3 wslAvailable tests are unaffected). `planRetrofit(c,t,agents,codeGraph?)`. `runRetrofit` resolves flag>config>default and persists. The minimal-code skill needs no code — the existing planners propagate it. ✓

## Notes

- ponytail build-vs-buy: BUILD chosen — Forge is itself a canon-injection harness, so the library's cross-agent install/propagation value is redundant; the MIT ruleset idea is captured natively and tailorably as a canon skill, credited.
- Serena's launch command and graphify's are best-effort; the retrofit report already warns users to adjust MCP commands to their installs.
