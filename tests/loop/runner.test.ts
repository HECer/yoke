import { describe, it, expect } from 'vitest'
import { buildClaudePrompt, claudeInvocation, agentInvocation, makeRunner, isAgentAvailable, buildReviewPrompt, makeReviewRunner } from '../../src/loop/runner.js'
import type { Story } from '../../src/loop/prd.js'

const story: Story = {
  id: 'S1', title: 'Add login', priority: 1,
  acceptance: ['returns 200 for valid creds', 'rejects bad creds'], passes: false,
}

describe('buildClaudePrompt', () => {
  it('includes the story id, title, and every acceptance criterion', () => {
    const p = buildClaudePrompt(story)
    expect(p).toContain('S1')
    expect(p).toContain('Add login')
    expect(p).toContain('returns 200 for valid creds')
    expect(p).toContain('rejects bad creds')
  })

  it('instructs the agent to implement only this story and not commit', () => {
    const p = buildClaudePrompt(story)
    expect(p).toMatch(/only this story/i)
    expect(p).toMatch(/not commit/i)
  })
})

describe('claudeInvocation', () => {
  it('passes the prompt via stdin (input), not as a CLI arg', () => {
    const inv = claudeInvocation('PROMPT TEXT', '/work')
    expect(inv.command).toBe('claude')
    expect(inv.args).toEqual(['-p'])
    expect(inv.args).not.toContain('PROMPT TEXT')
    expect(inv.options.input).toBe('PROMPT TEXT')
    expect(inv.options.cwd).toBe('/work')
  })

  it('uses shell mode only on Windows (to resolve the claude.cmd shim)', () => {
    const inv = claudeInvocation('p', '/work')
    expect(inv.options.shell).toBe(process.platform === 'win32')
  })
})

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

describe('buildReviewPrompt', () => {
  it('frames a reviewer role distinct from the implementer and lists acceptance criteria', () => {
    const p = buildReviewPrompt(story)
    expect(p).toMatch(/review/i)
    expect(p).toMatch(/did NOT implement|independent reviewer/i)
    expect(p).toContain('returns 200 for valid creds')
  })

  it('instructs the reviewer to reject (non-zero exit) on blocking issues and not to modify files', () => {
    const p = buildReviewPrompt(story)
    expect(p).toMatch(/exit non-zero|reject/i)
    expect(p).toMatch(/do not modify|do not commit/i)
  })
})

describe('makeReviewRunner', () => {
  it('returns a callable AgentRunner', () => {
    expect(typeof makeReviewRunner('claude')).toBe('function')
  })
})
