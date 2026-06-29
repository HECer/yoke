import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildClaudePrompt, claudeInvocation, agentInvocation, makeRunner, isAgentAvailable, buildReviewPrompt, makeReviewRunner, contextBlockFor, buildWatchdogInvocation, win32CommandString } from '../../src/loop/runner.js'
import type { Story } from '../../src/loop/prd.js'

const story: Story = {
  id: 'S1', title: 'Add login', priority: 1,
  acceptance: ['returns 200 for valid creds', 'rejects bad creds'], passes: false,
}

describe('buildClaudePrompt', () => {
  it('includes the story id, title, and every acceptance criterion', () => {
    const p = buildClaudePrompt(story, '')
    expect(p).toContain('S1')
    expect(p).toContain('Add login')
    expect(p).toContain('returns 200 for valid creds')
    expect(p).toContain('rejects bad creds')
  })

  it('instructs the agent to implement only this story and not commit', () => {
    const p = buildClaudePrompt(story, '')
    expect(p).toMatch(/only this story/i)
    expect(p).toMatch(/not commit/i)
  })
})

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
    const p = buildReviewPrompt(story, '')
    expect(p).toMatch(/review/i)
    expect(p).toMatch(/did NOT implement|independent reviewer/i)
    expect(p).toContain('returns 200 for valid creds')
  })

  it('instructs the reviewer to reject (non-zero exit) on blocking issues and not to modify files', () => {
    const p = buildReviewPrompt(story, '')
    expect(p).toMatch(/exit non-zero|reject/i)
    expect(p).toMatch(/do not modify|do not commit/i)
  })
})

describe('makeReviewRunner', () => {
  it('returns a callable AgentRunner', () => {
    expect(typeof makeReviewRunner('claude')).toBe('function')
  })
})

const ctxStory = { id: 'S1', title: 'First', priority: 1, acceptance: ['x'], passes: false }

describe('prompt context injection', () => {
  it('buildClaudePrompt omits the context section when no context is given', () => {
    const p = buildClaudePrompt(ctxStory, '')
    expect(p).not.toContain('Project context')
    expect(p).toContain('Story S1: First')
  })
  it('buildClaudePrompt includes the context block when provided', () => {
    const p = buildClaudePrompt(ctxStory, '## Project context\nGOAL')
    expect(p).toContain('## Project context')
    expect(p).toContain('GOAL')
    expect(p.indexOf('GOAL')).toBeLessThan(p.indexOf('Story S1'))
  })
  it('buildReviewPrompt includes the context block when provided', () => {
    expect(buildReviewPrompt(ctxStory, '## Project context\nGOAL')).toContain('GOAL')
  })
  it('contextBlockFor reads .yoke/context under the target dir', () => {
    const d = mkdtempSync(join(tmpdir(), 'yoke-cbf-'))
    mkdirSync(join(d, '.yoke', 'context'), { recursive: true })
    writeFileSync(join(d, '.yoke', 'context', 'PROJECT.md'), 'NORTHSTAR')
    expect(contextBlockFor(d)).toContain('NORTHSTAR')
    const empty = mkdtempSync(join(tmpdir(), 'yoke-empty-'))
    expect(contextBlockFor(empty)).toBe('')
    rmSync(d, { recursive: true, force: true })
    rmSync(empty, { recursive: true, force: true })
  })
})

describe('idle-timeout wiring', () => {
  it('wraps the agent command in the watchdog when idleTimeoutMs > 0', () => {
    const inv = buildWatchdogInvocation({ command: 'claude', args: ['-p'], input: 'hi', cwd: '.' }, 1200000)
    expect(inv.command).toBe('node')
    expect(inv.args.join(' ')).toContain('watchdog.js')
    expect(inv.args.join(' ')).toContain('--idle-ms=1200000')
    expect(inv.args.join(' ')).toContain('-- claude -p')
    expect(inv.input).toBe('hi')
    expect(inv.cwd).toBe('.')
  })
  it('returns the invocation unchanged when idleTimeoutMs is 0', () => {
    const base = { command: 'claude', args: ['-p'], input: 'hi', cwd: '.' }
    expect(buildWatchdogInvocation(base, 0)).toEqual(base)
  })
})

describe('win32CommandString', () => {
  it('quotes only args with spaces', () => {
    expect(win32CommandString('node', ['C:\\a b\\watchdog.js', '--idle-ms=5', '--', 'claude', '-p']))
      .toBe('node "C:\\a b\\watchdog.js" --idle-ms=5 -- claude -p')
  })
  it('leaves space-free commands untouched', () => {
    expect(win32CommandString('claude', ['-p'])).toBe('claude -p')
  })
})

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
