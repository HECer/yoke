import { describe, it, expect } from 'vitest'
import { buildClaudePrompt, claudeInvocation } from '../../src/loop/runner.js'
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
