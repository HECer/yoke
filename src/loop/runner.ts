import type { Story } from './prd.js'
import { execFileSync, execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { Agent } from '../retrofit/config.js'
import { loadContext, formatForPrompt, contextDir } from '../context/context.js'

export interface AgentContext {
  targetDir: string
  story: Story
}

export interface AgentResult {
  success: boolean
  summary: string
}

export type AgentRunner = (ctx: AgentContext) => AgentResult

export function contextBlockFor(targetDir: string): string {
  return formatForPrompt(loadContext(contextDir(targetDir)))
}

export function buildClaudePrompt(story: Story, context: string): string {
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

export function buildReviewPrompt(story: Story, context: string): string {
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

export interface Invocation {
  command: string
  args: string[]
  input: string
  cwd: string
}

const AGENT_SPECS: Record<Agent, { command: string; baseArgs: string[] }> = {
  claude: { command: 'claude', baseArgs: ['-p'] },
  codex: { command: 'codex', baseArgs: ['exec'] },
  gemini: { command: 'gemini', baseArgs: ['-p'] },
}

export function agentInvocation(agent: Agent, prompt: string, cwd: string): Invocation {
  const spec = AGENT_SPECS[agent]
  return { command: spec.command, args: spec.baseArgs, input: prompt, cwd }
}

export function claudeInvocation(prompt: string, cwd: string): Invocation {
  return agentInvocation('claude', prompt, cwd)
}

function watchdogPath(): string {
  // runner.js and watchdog.js sit side by side (dist/loop/ at runtime, src/loop/ under tsx)
  return fileURLToPath(new URL('./watchdog.js', import.meta.url))
}

// When idleTimeoutMs > 0, run the agent THROUGH the watchdog so a silent hang is
// killed after idleTimeoutMs of no output. The prompt still flows via stdin.
export function buildWatchdogInvocation(inv: Invocation, idleTimeoutMs: number): Invocation {
  if (idleTimeoutMs <= 0) return inv
  return {
    command: 'node',
    args: [watchdogPath(), `--idle-ms=${idleTimeoutMs}`, '--', inv.command, ...inv.args],
    input: inv.input,
    cwd: inv.cwd,
  }
}

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

export function makeRunner(agent: Agent, idleTimeoutMs = 0): AgentRunner {
  return (ctx: AgentContext): AgentResult => {
    const base = agentInvocation(agent, buildClaudePrompt(ctx.story, contextBlockFor(ctx.targetDir)), ctx.targetDir)
    const inv = buildWatchdogInvocation(base, idleTimeoutMs)
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

export const claudeRunner: AgentRunner = makeRunner('claude')

export function makeReviewRunner(agent: Agent, idleTimeoutMs = 0): AgentRunner {
  return (ctx: AgentContext): AgentResult => {
    const base = agentInvocation(agent, buildReviewPrompt(ctx.story, contextBlockFor(ctx.targetDir)), ctx.targetDir)
    const inv = buildWatchdogInvocation(base, idleTimeoutMs)
    try {
      runCli(inv)
      return { success: true, summary: `${agent} approved ${ctx.story.id}` }
    } catch (e) {
      return { success: false, summary: `${agent} rejected ${ctx.story.id}: ${(e as Error).message}` }
    }
  }
}

// Probe whether the agent's CLI is on PATH (so the loop can refuse upfront with a
// clear message instead of failing mid-run with spawn ENOENT). Never throws.
export function isAgentAvailable(agent: Agent): boolean {
  return probeVersion(AGENT_SPECS[agent].command)
}
