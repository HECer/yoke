import type { Story } from './prd.js'
import { execFileSync } from 'node:child_process'
import type { Agent } from '../retrofit/config.js'

export interface AgentContext {
  targetDir: string
  story: Story
}

export interface AgentResult {
  success: boolean
  summary: string
}

export type AgentRunner = (ctx: AgentContext) => AgentResult

export function buildClaudePrompt(story: Story): string {
  const criteria = story.acceptance.map(a => `- ${a}`).join('\n')
  return [
    'You are an autonomous coding agent running inside the Forge loop.',
    'Implement ONLY this story and nothing else. Follow test-driven development.',
    '',
    `Story ${story.id}: ${story.title}`,
    'Acceptance criteria (Definition of Done):',
    criteria,
    '',
    "When done, ensure the project's full test suite passes.",
    'Do NOT commit — the loop commits on your behalf after verifying.',
  ].join('\n')
}

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

export function claudeInvocation(prompt: string, cwd: string): Invocation {
  return agentInvocation('claude', prompt, cwd)
}

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
