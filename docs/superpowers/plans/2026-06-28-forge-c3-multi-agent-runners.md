# Forge — Baustein C3 (multi-agent loop runners) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the autonomous loop drive any of the three agents (Claude / Codex / Gemini), selected by config or a `--runner` flag, and refuse to start with a clear message if the chosen agent's CLI is not installed (a tool-surface-readiness gate that turns the dogfood ENOENT into an upfront error).

**Architecture:** Generalize the claude-only runner into an agent-parameterized one: `AGENT_SPECS` maps each agent to its headless CLI form, `agentInvocation(agent, prompt, cwd)` builds the cross-platform invocation (prompt via stdin, shell on Windows so `.cmd` shims resolve), and `makeRunner(agent)` returns an `AgentRunner`. `isAgentAvailable(agent)` probes `<cli> --version`. `runLoopCommand` resolves the runner from `--runner`/`config.agents` and gates on availability. Baustein C3; per-iteration git-worktree isolation and review-iteration with role separation are C4.

**Tech Stack:** Node.js (ESM), TypeScript, vitest. Extends C1/C2 `runner.ts`, `run-command.ts`, `cli.ts`. Back-compat: `claudeInvocation` and `claudeRunner` stay exported and behave identically.

**Builds on:** A+B1+B2+C1+C2+B3 on `main`. Modifies: `src/loop/runner.ts`, `src/loop/run-command.ts`, `src/cli.ts`, `canon/loop/loop-spec.md`.

---

## File Structure

```
src/loop/
  runner.ts        # MODIFY: AGENT_SPECS, agentInvocation, makeRunner, isAgentAvailable; keep claudeInvocation/claudeRunner
  run-command.ts   # MODIFY: resolve runner by agent + readiness gate (injectable); RunLoopCommandOptions gains agent?, isAvailable?
cli.ts (src/cli.ts) # MODIFY: loop run parses --runner=<agent>
canon/loop/loop-spec.md  # MODIFY: document multi-agent runner + readiness gate
tests/loop/
  runner.test.ts            # MODIFY: agentInvocation per agent; isAgentAvailable boolean
  loop-cli.integration.test.ts  # MODIFY: readiness-gate refusal via stub
```

---

### Task 1: Generalize the runner to all three agents

**Files:**
- Modify: `src/loop/runner.ts`
- Test: `tests/loop/runner.test.ts` (extend)

- [ ] **Step 1: Add failing tests**

In `tests/loop/runner.test.ts`, extend the import and add cases:
```ts
import { buildClaudePrompt, claudeInvocation, agentInvocation, makeRunner, isAgentAvailable } from '../../src/loop/runner.js'
```
Add after the existing `claudeInvocation` describe block:
```ts
describe('agentInvocation', () => {
  it('maps codex to `codex exec` with the prompt on stdin', () => {
    const inv = agentInvocation('codex', 'P', '/w')
    expect(inv.command).toBe('codex')
    expect(inv.args).toEqual(['exec'])
    expect(inv.options.input).toBe('P')
    expect(inv.args).not.toContain('P')
  })

  it('maps gemini to `gemini -p` with the prompt on stdin', () => {
    const inv = agentInvocation('gemini', 'P', '/w')
    expect(inv.command).toBe('gemini')
    expect(inv.args).toEqual(['-p'])
    expect(inv.options.input).toBe('P')
  })

  it('claude back-compat: claudeInvocation equals agentInvocation(claude)', () => {
    expect(claudeInvocation('P', '/w')).toEqual(agentInvocation('claude', 'P', '/w'))
  })

  it('uses shell mode only on Windows for every agent', () => {
    expect(agentInvocation('gemini', 'P', '/w').options.shell).toBe(process.platform === 'win32')
  })
})

describe('makeRunner / isAgentAvailable', () => {
  it('makeRunner returns a callable AgentRunner', () => {
    expect(typeof makeRunner('codex')).toBe('function')
  })

  it('isAgentAvailable returns a boolean and never throws', () => {
    expect(typeof isAgentAvailable('claude')).toBe('boolean')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- loop/runner`
Expected: FAIL — `agentInvocation`/`makeRunner`/`isAgentAvailable` not exported.

- [ ] **Step 3: Modify `src/loop/runner.ts`**

Add the `Agent` type import at the top (keep existing imports):
```ts
import type { Agent } from '../retrofit/config.js'
```

Rename the `ClaudeInvocation` interface to `Invocation` (it is a structural shape; the existing test uses the function, not the type name):
```ts
export interface Invocation {
  command: string
  args: string[]
  options: {
    cwd: string
    input: string
    stdio: ['pipe', 'inherit', 'inherit']
    shell: boolean
  }
}
```

Add the spec map and `agentInvocation` (place above `claudeInvocation`):
```ts
const AGENT_SPECS: Record<Agent, { command: string; baseArgs: string[] }> = {
  claude: { command: 'claude', baseArgs: ['-p'] },
  codex: { command: 'codex', baseArgs: ['exec'] },
  gemini: { command: 'gemini', baseArgs: ['-p'] },
}

// Build a cross-platform headless invocation for an agent. The prompt goes via
// stdin (so it needs no shell escaping); shell mode is enabled on Windows so the
// agent's `.cmd` shim resolves via PATHEXT (the only args are safe literal flags).
export function agentInvocation(agent: Agent, prompt: string, cwd: string): Invocation {
  const spec = AGENT_SPECS[agent]
  return {
    command: spec.command,
    args: spec.baseArgs,
    options: {
      cwd,
      input: prompt,
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: process.platform === 'win32',
    },
  }
}
```

Replace `claudeInvocation` with a thin back-compat wrapper:
```ts
export function claudeInvocation(prompt: string, cwd: string): Invocation {
  return agentInvocation('claude', prompt, cwd)
}
```

Add `makeRunner` and `isAgentAvailable`, and redefine `claudeRunner` in terms of `makeRunner` (replace the existing `claudeRunner` function):
```ts
export function makeRunner(agent: Agent): AgentRunner {
  return (ctx: AgentContext): AgentResult => {
    const inv = agentInvocation(agent, buildClaudePrompt(ctx.story), ctx.targetDir)
    try {
      // NOTE: The loop trusts the agent's exit code as a proxy for "it ran".
      // Independent test verification happens in the loop (Baustein C2), not here.
      execFileSync(inv.command, inv.args, inv.options)
      return { success: true, summary: `${agent} implemented ${ctx.story.id}` }
    } catch (e) {
      return { success: false, summary: `${agent} failed on ${ctx.story.id}: ${(e as Error).message}` }
    }
  }
}

export const claudeRunner: AgentRunner = makeRunner('claude')

// Probe whether the agent's CLI is on PATH (so the loop can refuse upfront with a
// clear message instead of failing mid-run with spawn ENOENT). Never throws.
export function isAgentAvailable(agent: Agent): boolean {
  const spec = AGENT_SPECS[agent]
  try {
    execFileSync(spec.command, ['--version'], {
      stdio: 'pipe',
      shell: process.platform === 'win32',
      timeout: 5000,
    })
    return true
  } catch {
    return false
  }
}
```

Remove the now-superseded old `claudeInvocation` body and old `claudeRunner` body (replaced above). Keep `buildClaudePrompt`, `AgentContext`, `AgentResult`, `AgentRunner`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- loop/runner`
Expected: PASS (existing claude tests + 6 new).

- [ ] **Step 5: Commit**

```bash
git add src/loop/runner.ts tests/loop/runner.test.ts
git commit -m "feat: generalize loop runner to claude/codex/gemini + availability probe"
```

---

### Task 2: Runner selection + readiness gate in run-command

**Files:**
- Modify: `src/loop/run-command.ts`
- Test: `tests/loop/loop-cli.integration.test.ts` (extend)

- [ ] **Step 1: Add failing tests**

In `tests/loop/loop-cli.integration.test.ts`, add a case for the readiness refusal. Add to the existing `describe`:
```ts
  it('refuses to run when the selected agent CLI is unavailable', () => {
    saveConfig(dir, { ...cfg(), verify: { command: 'node -e "process.exit(0)"' } })
    const code = runLoopCommand(dir, {
      maxIterations: 5,
      git: stubGit,
      verify: verifyOk,
      agent: 'codex',
      isAvailable: () => false,
    })
    expect(code).toBe(2)
    expect(loadPrd(join(dir, '.forge', 'prd.yaml'))[0].passes).toBe(false)
  })

  it('does not run the readiness gate when a runner is injected', () => {
    saveConfig(dir, { ...cfg(), verify: { command: 'node -e "process.exit(0)"' } })
    const code = runLoopCommand(dir, {
      maxIterations: 5,
      runner: passRunner,
      git: stubGit,
      verify: verifyOk,
      isAvailable: () => false, // ignored because runner is injected
    })
    expect(code).toBe(0)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- loop-cli`
Expected: FAIL — `RunLoopCommandOptions` has no `agent`/`isAvailable`; no readiness gate.

- [ ] **Step 3: Modify `src/loop/run-command.ts`**

Update the runner import and add the new symbols + `Agent` type:
```ts
import { claudeRunner, makeRunner, isAgentAvailable, type AgentRunner } from './runner.js'
import type { Agent } from '../retrofit/config.js'
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
}
```

In `runLoopCommand`, after the verify resolution block and before the `runLoop` call, resolve the runner with the readiness gate:
```ts
  let runner = opts.runner
  if (!runner) {
    const agent: Agent = opts.agent ?? config.agents[0] ?? 'claude'
    const available = opts.isAvailable ?? isAgentAvailable
    if (!available(agent)) {
      console.error(`Agent CLI "${agent}" was not found on PATH. Install it, or pick another with --runner=<claude|codex|gemini>.`)
      return 2
    }
    runner = makeRunner(agent)
  }
```
Then change the `runLoop` call to use the resolved `runner` instead of `opts.runner ?? claudeRunner`:
```ts
  const result = runLoop({
    prdPath: path,
    targetDir,
    runner,
    git: opts.git ?? realGitOps,
    verify,
    maxIterations: opts.maxIterations,
  })
```
(`claudeRunner` is still imported for back-compat consumers but no longer the inline default; if the unused-import check complains, the `claudeRunner` import may be dropped — but keep `makeRunner`/`isAgentAvailable`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- loop-cli`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Modify `src/cli.ts` to parse `--runner=`**

In the `loop` case, in the `run` branch, parse the runner flag and pass it through. Replace the `run` sub-branch body:
```ts
      if (sub === 'run') {
        const maxArg = rest.find(a => a.startsWith('--max='))
        const rawMax = maxArg ? Number(maxArg.slice('--max='.length)) : 25
        if (!Number.isFinite(rawMax) || rawMax <= 0) {
          console.error(`Invalid --max value: ${maxArg}`)
          return 1
        }
        const runnerArg = rest.find(a => a.startsWith('--runner='))?.slice('--runner='.length)
        const valid = ['claude', 'codex', 'gemini']
        const agent = runnerArg && valid.includes(runnerArg) ? (runnerArg as Agent) : undefined
        if (runnerArg && !agent) {
          console.error(`Invalid --runner value: ${runnerArg} (expected claude|codex|gemini)`)
          return 1
        }
        return runLoopCommand(targetDir, { maxIterations: rawMax, agent })
      }
```
Add the `Agent` type import near the top of `src/cli.ts` if not already present:
```ts
import type { Agent } from './retrofit/config.js'
```
(It may already be imported for the `retrofit --agent` parsing — if so, do not duplicate.)

- [ ] **Step 6: Run the full suite + build**

Run: `npm test`
Expected: all pass.

Run: `npm run build`
Expected: tsc 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/loop/run-command.ts src/cli.ts tests/loop/loop-cli.integration.test.ts
git commit -m "feat: select loop runner by agent with a tool-readiness gate"
```

---

### Task 3: Update canon loop-spec

**Files:**
- Modify: `canon/loop/loop-spec.md`

- [ ] **Step 1: Update the runner + limitations language**

In `canon/loop/loop-spec.md`, update step 4 and the Limitations section. Change step 4 to:
```markdown
4. Run a fresh agent to implement ONE story. The runner is selected by `--runner=<claude|codex|gemini>` or the first configured agent (default claude); the loop refuses to start if that agent's CLI is not installed.
```
Replace the Limitations section with:
```markdown
## Limitations
- Each iteration runs in the working tree directly; per-iteration git-worktree isolation and a review-iteration with role separation are Baustein C4.
- The loop verifies via the project's test command, not a per-agent semantic review.
```

- [ ] **Step 2: Validate the canon**

Run: `npm run forge -- validate canon`
Expected: `✓ canon valid (canon)`.

Run: `npm test -- real-canon`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add canon/loop/loop-spec.md
git commit -m "docs: canon loop-spec documents multi-agent runner + readiness gate"
```

---

## Self-Review

**1. Spec coverage (Baustein C3 scope):**
- Codex + Gemini runners (generalized `agentInvocation`/`makeRunner`) → Task 1 ✓
- Runner selection by config/flag → Tasks 2 (config + opts), 2 step 5 (`--runner`) ✓
- Tool-surface-readiness gate (refuse if CLI missing) → Tasks 1 (`isAgentAvailable`), 2 (gate) ✓
- Back-compat (claudeInvocation/claudeRunner unchanged behavior) → Task 1 ✓
- Deterministic tests (injectable `isAvailable`, structural invocation asserts — no real codex/gemini needed) → Tasks 1, 2 ✓
- (Deferred to C4: per-iteration git-worktree isolation, review-iteration with role separation. Correct.)

**2. Placeholder scan:** No TBD/TODO. The "drop the claudeRunner import if unused" note is a conditional cleanup, not a placeholder. Every code step is complete.

**3. Type consistency:** `Agent` (from config), `Invocation` (renamed from `ClaudeInvocation`), `agentInvocation`, `makeRunner`, `isAgentAvailable`, `claudeInvocation` (wrapper), `claudeRunner` (= `makeRunner('claude')`), `RunLoopCommandOptions` (gains `agent?`, `isAvailable?`). The C1 dogfood Windows-spawn approach (stdin + shell on win32) is preserved and now applied uniformly to all agents. `buildClaudePrompt` is reused for all agents (agent-agnostic content). ✓

## Next Plans (not this document)

- **Plan C4 — Loop isolation + review:** per-iteration git-worktree isolation (run each story in a fresh worktree, merge on green), review-iteration with role separation (a second agent pass reviews before the story is marked done).
