import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildClaudePrompt, claudeInvocation, agentInvocation, makeRunner, isAgentAvailable, buildReviewPrompt, makeReviewRunner, contextBlockFor, buildWatchdogInvocation, win32CommandString, parseClaudeStreamUsage, runnerInvocation, type Invocation } from '../../src/loop/runner.js'
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

  it('enforces scope discipline and forbids summary/analysis documents', () => {
    const p = buildClaudePrompt(story, '')
    expect(p).toMatch(/beyond what the story requires/i)
    expect(p).toMatch(/summary, plan, or analysis documents/i)
  })

  it('demands faithful reporting and root-cause fixes instead of bypasses', () => {
    const p = buildClaudePrompt(story, '')
    expect(p).toMatch(/report the outcome faithfully/i)
    expect(p).toMatch(/root cause/i)
    expect(p).toMatch(/--no-verify|weaken(ing)? tests/i)
  })

  it('bounds the final message to a few sentences', () => {
    expect(buildClaudePrompt(story, '')).toMatch(/final message .*few short sentences/i)
  })
})

describe('claudeInvocation', () => {
  it('passes the prompt as input, not as a CLI arg', () => {
    const inv = claudeInvocation('PROMPT TEXT', '/work')
    expect(inv.command).toBe('claude')
    expect(inv.args).toEqual(['-p', '--dangerously-skip-permissions'])
    expect(inv.input).toBe('PROMPT TEXT')
    expect(inv.args).not.toContain('PROMPT TEXT')
    expect((inv as Record<string, unknown>).shell).toBeUndefined()
  })
})

describe('agentInvocation', () => {
  it('maps codex to `codex exec` with the prompt as input', () => {
    const inv = agentInvocation('codex', 'P', '/w')
    expect(inv.command).toBe('codex')
    expect(inv.args).toEqual(['exec', '--dangerously-bypass-approvals-and-sandbox'])
    expect(inv.input).toBe('P')
    expect(inv.args).not.toContain('P')
  })

  it('maps gemini to stdin-driven headless mode (no bare -p: current gemini requires a value after -p)', () => {
    const inv = agentInvocation('gemini', 'P', '/w')
    expect(inv.command).toBe('gemini')
    expect(inv.args).toEqual(['--yolo'])
    expect(inv.input).toBe('P')
  })

  it('every agent runs non-interactively (a headless permission-bypass flag is present)', () => {
    // Without these flags a headless CLI denies every write prompt: the runner
    // "succeeds" (exit 0) while producing nothing, and the loop falsely passes.
    expect(agentInvocation('claude', 'P', '/w').args).toContain('--dangerously-skip-permissions')
    expect(agentInvocation('codex', 'P', '/w').args).toContain('--dangerously-bypass-approvals-and-sandbox')
    expect(agentInvocation('gemini', 'P', '/w').args).toContain('--yolo')
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

  it('grounds the verdict in observed evidence and keeps output brief', () => {
    const p = buildReviewPrompt(story, '')
    expect(p).toMatch(/actually (show|verified|observe)/i)
    expect(p).toMatch(/few short sentences/i)
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

describe('parseClaudeStreamUsage', () => {
  const assistant = (input: number, output: number) =>
    JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: input, output_tokens: output } } })
  const result = (input: number, output: number) =>
    JSON.stringify({ type: 'result', usage: { input_tokens: input, output_tokens: output } })

  it('prefers the result message usage (already cumulative for the run)', () => {
    const usage = parseClaudeStreamUsage([assistant(10, 5), assistant(20, 7), result(35, 13)])
    expect(usage).toEqual({ inputTokens: 35, outputTokens: 13 })
  })
  it('sums assistant message usages when no result message exists', () => {
    const usage = parseClaudeStreamUsage([assistant(10, 5), assistant(3, 2)])
    expect(usage).toEqual({ inputTokens: 13, outputTokens: 7 })
  })
  it('uses the LAST result message when several appear', () => {
    const usage = parseClaudeStreamUsage([result(1, 1), result(9, 4)])
    expect(usage).toEqual({ inputTokens: 9, outputTokens: 4 })
  })
  it('ignores garbage lines, unknown types, and blank lines', () => {
    const usage = parseClaudeStreamUsage([
      'not json at all', '', '{"type":"system","subtype":"init"}', '[1,2,3]', 'null',
      assistant(4, 2),
      '{"type":"tool_result","ok":true}',
    ])
    expect(usage).toEqual({ inputTokens: 4, outputTokens: 2 })
  })
  it('returns zeros when nothing carries usage', () => {
    expect(parseClaudeStreamUsage(['{"type":"system"}', 'garbage'])).toEqual({ inputTokens: 0, outputTokens: 0 })
    expect(parseClaudeStreamUsage([])).toEqual({ inputTokens: 0, outputTokens: 0 })
  })
  it('falls back to assistant sums when the result message lacks usage', () => {
    const usage = parseClaudeStreamUsage([assistant(6, 3), '{"type":"result","subtype":"success"}'])
    expect(usage).toEqual({ inputTokens: 6, outputTokens: 3 })
  })
  it('ignores non-numeric usage fields defensively', () => {
    const usage = parseClaudeStreamUsage([
      '{"type":"assistant","message":{"usage":{"input_tokens":"NaNish","output_tokens":5}}}',
      assistant(2, 1),
    ])
    expect(usage).toEqual({ inputTokens: 2, outputTokens: 6 })
  })

  it('captures the model id from the system/init message', () => {
    const usage = parseClaudeStreamUsage([
      '{"type":"system","subtype":"init","model":"claude-opus-4-6-20260501"}',
      assistant(4, 2),
    ])
    expect(usage.model).toBe('claude-opus-4-6-20260501')
  })

  it('captures the model id from an assistant message.model', () => {
    const usage = parseClaudeStreamUsage([
      JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5-20260615', usage: { input_tokens: 3, output_tokens: 1 } } }),
    ])
    expect(usage.model).toBe('claude-sonnet-5-20260615')
  })

  it('uses the LAST seen model id when init and assistant messages disagree', () => {
    const usage = parseClaudeStreamUsage([
      '{"type":"system","subtype":"init","model":"claude-opus-4-6-20260501"}',
      JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5-20260615', usage: { input_tokens: 3, output_tokens: 1 } } }),
    ])
    expect(usage.model).toBe('claude-sonnet-5-20260615')
  })

  it('omits model when no message carries one', () => {
    const usage = parseClaudeStreamUsage([assistant(4, 2), '{"type":"result","subtype":"success"}'])
    expect(usage.model).toBeUndefined()
    expect('model' in usage).toBe(false)
  })

  it('ignores a non-string model field defensively', () => {
    const usage = parseClaudeStreamUsage([
      '{"type":"system","subtype":"init","model":12345}',
      assistant(1, 1),
    ])
    expect(usage.model).toBeUndefined()
  })
})

describe('runnerInvocation (token-report wiring)', () => {
  it('claude with tokenReport uses stream-json output with --verbose, prompt still on stdin', () => {
    const inv = runnerInvocation('claude', 'P', '/w', true)
    expect(inv.command).toBe('claude')
    expect(inv.args).toEqual(['-p', '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose'])
    expect(inv.input).toBe('P')
    expect(inv.cwd).toBe('/w')
  })
  it('the stream-json path keeps the headless permission-bypass flag', () => {
    // The token hook must not silently drop the non-interactive flag — a claude
    // that cannot write files "succeeds" while doing nothing.
    expect(runnerInvocation('claude', 'P', '/w', true).args).toContain('--dangerously-skip-permissions')
  })
  it('claude ALWAYS uses stream-json — the idle watchdog needs liveness output, and plain -p is silent until done', () => {
    // Regression guard: with the plain -p invocation, healthy stories longer than
    // the idle window emitted no output and were killed at exactly idle-timeout.
    expect(runnerInvocation('claude', 'P', '/w', false).args).toEqual(['-p', '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose'])
    expect(runnerInvocation('claude', 'P', '/w')).toEqual(runnerInvocation('claude', 'P', '/w', true))
  })
  it('non-claude agents are unchanged even when tokenReport is requested', () => {
    expect(runnerInvocation('codex', 'P', '/w', true)).toEqual(agentInvocation('codex', 'P', '/w'))
    expect(runnerInvocation('gemini', 'P', '/w', true)).toEqual(agentInvocation('gemini', 'P', '/w'))
  })
})

describe('makeRunner claude default (no tokenReport flag)', () => {
  it('captures stream-json and reports tokens even without tokenReport', () => {
    const d = mkdtempSync(join(tmpdir(), 'yoke-tok0-'))
    const seen: Invocation[] = []
    const runner = makeRunner('claude', 0, { execCapture: (inv) => { seen.push(inv); return '{"type":"result","subtype":"success","usage":{"input_tokens":3,"output_tokens":2}}' } })
    const res = runner({ targetDir: d, story })
    rmSync(d, { recursive: true, force: true })
    expect(res.success).toBe(true)
    expect(res.tokens).toEqual({ inputTokens: 3, outputTokens: 2 })
    expect(seen[0].args).toContain('stream-json')
  })
})

describe('makeRunner with tokenReport', () => {
  const streamLines = [
    '{"type":"system","subtype":"init","model":"claude-opus-4-6-20260501"}',
    '{"type":"assistant","message":{"usage":{"input_tokens":10,"output_tokens":4}}}',
    '{"type":"result","subtype":"success","usage":{"input_tokens":15,"output_tokens":8}}',
  ].join('\n')

  it('returns cumulative tokens from a stubbed stream-json invocation', () => {
    const d = mkdtempSync(join(tmpdir(), 'yoke-tok-'))
    const seen: Invocation[] = []
    const runner = makeRunner('claude', 0, { tokenReport: true, execCapture: (inv) => { seen.push(inv); return streamLines } })
    const res = runner({ targetDir: d, story })
    rmSync(d, { recursive: true, force: true })
    expect(res.success).toBe(true)
    expect(res.tokens).toEqual({ inputTokens: 15, outputTokens: 8, model: 'claude-opus-4-6-20260501' })
    expect(seen).toHaveLength(1)
    expect(seen[0].args).toContain('stream-json')
    expect(seen[0].input).toContain('S1')  // the prompt still flows via stdin
  })

  it('salvages token usage from stdout when the agent exits non-zero', () => {
    const d = mkdtempSync(join(tmpdir(), 'yoke-tok2-'))
    const boom = Object.assign(new Error('exit 1'), { stdout: streamLines })
    const runner = makeRunner('claude', 0, { tokenReport: true, execCapture: () => { throw boom } })
    const res = runner({ targetDir: d, story })
    rmSync(d, { recursive: true, force: true })
    expect(res.success).toBe(false)
    expect(res.tokens).toEqual({ inputTokens: 15, outputTokens: 8, model: 'claude-opus-4-6-20260501' })
  })

  it('routes non-claude agents through the normal exec path even with tokenReport', () => {
    const d = mkdtempSync(join(tmpdir(), 'yoke-tok3-'))
    let captured = 0
    const invs: Invocation[] = []
    const runner = makeRunner('codex', 0, {
      tokenReport: true,
      execCapture: () => { captured += 1; return '' },
      exec: (inv) => { invs.push(inv) },
    })
    const res = runner({ targetDir: d, story })
    rmSync(d, { recursive: true, force: true })
    expect(captured).toBe(0)                 // capture path is claude-only
    expect(invs).toHaveLength(1)
    expect(invs[0].args).toEqual(['exec', '--dangerously-bypass-approvals-and-sandbox'])   // plain codex invocation, no stream-json flags
    expect(res.success).toBe(true)
    expect(res.tokens).toBeUndefined()
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
