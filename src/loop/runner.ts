import type { Story } from './prd.js'
import { execFileSync } from 'node:child_process'

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

export interface ClaudeInvocation {
  command: string
  args: string[]
  options: {
    cwd: string
    input: string
    stdio: ['pipe', 'inherit', 'inherit']
    shell: boolean
  }
}

// Build the cross-platform invocation for `claude -p`. The prompt is passed via
// stdin (documented `claude -p` usage), so it needs no shell escaping. On Windows
// `claude` is a `.cmd` shim that execFileSync cannot resolve via PATHEXT without a
// shell, so shell mode is enabled there (the only arg is the safe literal `-p`).
export function claudeInvocation(prompt: string, cwd: string): ClaudeInvocation {
  return {
    command: 'claude',
    args: ['-p'],
    options: {
      cwd,
      input: prompt,
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: process.platform === 'win32',
    },
  }
}

export function claudeRunner(ctx: AgentContext): AgentResult {
  const prompt = buildClaudePrompt(ctx.story)
  const inv = claudeInvocation(prompt, ctx.targetDir)
  try {
    // NOTE: The loop trusts claude's exit code as a proxy for "tests green".
    // There is no independent test run here. Full verification is deferred to C2.
    execFileSync(inv.command, inv.args, inv.options)
    return { success: true, summary: `claude implemented ${ctx.story.id}` }
  } catch (e) {
    return { success: false, summary: `claude failed on ${ctx.story.id}: ${(e as Error).message}` }
  }
}
