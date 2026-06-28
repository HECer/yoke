# Forge — Cleanup: remove DEP0190 (shell:true) warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the Node `DEP0190` deprecation warning emitted whenever an agent CLI is invoked, without losing Windows `.cmd`-shim resolution.

**Root cause:** `src/loop/runner.ts` runs agent CLIs with `execFileSync(command, args, { shell: true })` on Windows (so `claude.cmd`/`codex.cmd`/`gemini.cmd` resolve via PATHEXT). Node 22+ deprecates passing an args array together with `shell: true` (DEP0190). Our args are always literal flags (`-p`, `exec`, `--version`) and the prompt is passed via stdin, so there is no injection risk — but the warning fires.

**Fix:** On Windows, run the invocation as a single shell command string via `execSync` (no separate args array → no DEP0190); the literal flags are concatenated safely and the prompt is still piped via stdin (`input`). On non-Windows, keep `execFileSync(command, args)` with no shell (already warning-free). Centralize this in one `runCli` helper plus a `probeVersion` helper so both the runner and the availability probe share it.

**Tech Stack:** Node.js (ESM), TypeScript, vitest. Touches one source file + its test.

**Builds on:** A+B1+B2+B3+C1–C5 on `main`. Modifies: `src/loop/runner.ts`, `tests/loop/runner.test.ts`.

---

## File Structure

```
src/loop/runner.ts        # MODIFY: Invocation shape (drop shell/stdio); runCli + probeVersion; runners + isAgentAvailable use them
tests/loop/runner.test.ts # MODIFY: agentInvocation assertions match the new shape; add a no-DEP0190 guard
```

---

### Task 1: Centralize CLI execution without shell:true args

**Files:**
- Modify: `src/loop/runner.ts`
- Test: `tests/loop/runner.test.ts`

- [ ] **Step 1: Update the failing tests**

In `tests/loop/runner.test.ts`, the existing `agentInvocation` / `claudeInvocation` tests assert `inv.options.input` and `inv.options.shell`. Update them to the new flat shape (`inv.input`, no `shell`), and add a guard that running a (failing) probe does not print DEP0190. Replace the `describe('agentInvocation', ...)` and the claude back-compat assertions with:
```ts
describe('agentInvocation', () => {
  it('maps codex to `codex exec` with the prompt as input', () => {
    const inv = agentInvocation('codex', 'P', '/w')
    expect(inv.command).toBe('codex')
    expect(inv.args).toEqual(['exec'])
    expect(inv.input).toBe('P')
    expect(inv.args).not.toContain('P')
  })

  it('maps gemini to `gemini -p` with the prompt as input', () => {
    const inv = agentInvocation('gemini', 'P', '/w')
    expect(inv.command).toBe('gemini')
    expect(inv.args).toEqual(['-p'])
    expect(inv.input).toBe('P')
  })

  it('claude back-compat: claudeInvocation equals agentInvocation(claude)', () => {
    expect(claudeInvocation('P', '/w')).toEqual(agentInvocation('claude', 'P', '/w'))
  })

  it('carries the cwd', () => {
    expect(agentInvocation('claude', 'P', '/w').cwd).toBe('/w')
  })
})
```
Also update the existing `claudeInvocation` describe block (the one added in C1 that checks `options.input` / `options.shell`) to the flat shape — assert `claudeInvocation('P','/w')` has `.command === 'claude'`, `.args` equal `['-p']`, `.input === 'P'`, and no `.options`/`.shell` property:
```ts
describe('claudeInvocation', () => {
  it('passes the prompt as input, not as a CLI arg', () => {
    const inv = claudeInvocation('PROMPT TEXT', '/work')
    expect(inv.command).toBe('claude')
    expect(inv.args).toEqual(['-p'])
    expect(inv.input).toBe('PROMPT TEXT')
    expect(inv.args).not.toContain('PROMPT TEXT')
    expect((inv as Record<string, unknown>).shell).toBeUndefined()
  })
})
```
Add a regression guard that the version probe of a non-existent command returns false and emits no DEP0190 on stderr (capture process warnings):
```ts
describe('no DEP0190', () => {
  it('isAgentAvailable does not emit a DEP0190 deprecation warning', () => {
    const warnings: string[] = []
    const onWarn = (w: Error) => warnings.push(String(w))
    process.on('warning', onWarn)
    try {
      // a definitely-absent command — returns false, must not warn
      isAgentAvailable('claude')
    } finally {
      process.off('warning', onWarn)
    }
    expect(warnings.some(w => w.includes('DEP0190'))).toBe(false)
  })
})
```
(Note: the warning is emitted asynchronously by Node; this guard is best-effort. The primary verification is Step 5's manual check that `npm test` output no longer contains DEP0190.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- loop/runner`
Expected: FAIL — the tests now reference `inv.input`/`inv.cwd` (flat shape) which don't exist yet.

- [ ] **Step 3: Rewrite the execution internals in `src/loop/runner.ts`**

Change the imports to include `execSync`:
```ts
import { execFileSync, execSync } from 'node:child_process'
```

Replace the `Invocation` interface with the flat shape (drop `options`):
```ts
export interface Invocation {
  command: string
  args: string[]
  input: string
  cwd: string
}
```

Update `agentInvocation` to return the flat shape (no `options`, no `shell`/`stdio`):
```ts
export function agentInvocation(agent: Agent, prompt: string, cwd: string): Invocation {
  const spec = AGENT_SPECS[agent]
  return { command: spec.command, args: spec.baseArgs, input: prompt, cwd }
}
```
(`claudeInvocation` stays a thin wrapper: `return agentInvocation('claude', prompt, cwd)`.)

Add the two execution helpers (place above `makeRunner`):
```ts
// Execute a CLI invocation. On Windows the agent CLIs are `.cmd` shims that
// execFileSync cannot resolve without a shell; but passing an args array with
// shell:true triggers DEP0190. So on win32 we run a single command string via
// execSync (our args are literal flags, never user data — the prompt is piped via
// stdin), which avoids the warning. On other platforms execFileSync with no shell
// is already warning-free. Throws on a non-zero exit (caller catches).
function runCli(inv: Invocation): void {
  if (process.platform === 'win32') {
    execSync([inv.command, ...inv.args].join(' '), {
      cwd: inv.cwd,
      input: inv.input,
      stdio: ['pipe', 'inherit', 'inherit'],
    })
  } else {
    execFileSync(inv.command, inv.args, {
      cwd: inv.cwd,
      input: inv.input,
      stdio: ['pipe', 'inherit', 'inherit'],
    })
  }
}

// Probe whether a CLI is on PATH via `<command> --version`. Same win32/other split
// as runCli to stay DEP0190-free. Never throws.
function probeVersion(command: string): boolean {
  try {
    if (process.platform === 'win32') {
      execSync(`${command} --version`, { stdio: 'pipe', timeout: 5000 })
    } else {
      execFileSync(command, ['--version'], { stdio: 'pipe', timeout: 5000 })
    }
    return true
  } catch {
    return false
  }
}
```

Update `makeRunner` to use `runCli` (replace its `execFileSync(...)` call):
```ts
export function makeRunner(agent: Agent): AgentRunner {
  return (ctx: AgentContext): AgentResult => {
    const inv = agentInvocation(agent, buildClaudePrompt(ctx.story), ctx.targetDir)
    try {
      // NOTE: the loop trusts the agent's exit code as a proxy for "it ran".
      // Independent verification happens in the loop (Baustein C2), not here.
      runCli(inv)
      return { success: true, summary: `${agent} implemented ${ctx.story.id}` }
    } catch (e) {
      return { success: false, summary: `${agent} failed on ${ctx.story.id}: ${(e as Error).message}` }
    }
  }
}
```

Update `makeReviewRunner` the same way (replace its `execFileSync(...)` with `runCli(inv)`):
```ts
export function makeReviewRunner(agent: Agent): AgentRunner {
  return (ctx: AgentContext): AgentResult => {
    const inv = agentInvocation(agent, buildReviewPrompt(ctx.story), ctx.targetDir)
    try {
      runCli(inv)
      return { success: true, summary: `${agent} approved ${ctx.story.id}` }
    } catch (e) {
      return { success: false, summary: `${agent} rejected ${ctx.story.id}: ${(e as Error).message}` }
    }
  }
}
```

Update `isAgentAvailable` to delegate to `probeVersion` (replace its body's try/catch with):
```ts
export function isAgentAvailable(agent: Agent): boolean {
  return probeVersion(AGENT_SPECS[agent].command)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- loop/runner`
Expected: PASS (updated assertions + the new guard).

- [ ] **Step 5: Verify the warning is gone across the whole suite + build**

Run: `npm test 2>&1` and search the output for `DEP0190`.
Expected: NO `DEP0190` line anywhere in the test output (it previously appeared under `runner.test.ts`). All tests pass.

Run: `npm run build`
Expected: tsc 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/loop/runner.ts tests/loop/runner.test.ts
git commit -m "fix: avoid DEP0190 by running win32 CLIs via execSync string"
```

---

## Self-Review

**1. Coverage:** DEP0190 root cause (args array + shell:true) removed at every call site — `makeRunner`, `makeReviewRunner` (via `runCli`), and `isAgentAvailable` (via `probeVersion`). Windows `.cmd` resolution preserved (execSync uses cmd.exe). Non-Windows path unchanged (execFileSync, no shell). ✓

**2. Placeholder scan:** No TBD/TODO; complete code in every step. ✓

**3. Type consistency:** `Invocation` flattened to `{command,args,input,cwd}`; `agentInvocation`/`claudeInvocation` return it; `runCli(inv)` and `probeVersion(command)` are the only executors. No consumer outside `runner.ts` reads `Invocation.options` (run-command/loop use `makeRunner`/`makeReviewRunner`/`isAgentAvailable`, not the shape). The C1 back-compat identity `claudeInvocation === agentInvocation('claude')` holds. Tests updated to the flat shape. ✓

**Safety note:** `runCli` builds the win32 command string from `inv.command` + `inv.args`, both of which are literal constants from `AGENT_SPECS` (never user/PRD data); the prompt — the only user-influenced input — is passed via stdin (`input`), so no shell-injection surface is introduced.
