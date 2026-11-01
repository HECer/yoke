import { describe, expect, it } from 'vitest'
import { assessContract as assess, parseOptions } from '../../bench/provider-contract-smoke.mjs'
import { parseProviderResult } from '../../src/agents/telemetry.js'
import type { Agent } from '../../src/retrofit/config.js'

const assessContract = (agent: Agent, result: { stdout: string }, nonce: string, unchanged: boolean) =>
  assess(parseProviderResult(agent, result.stdout), result, nonce, unchanged)

const nonce = 'fixture-identity'
const result = (payload: unknown) => ({
  kind: 'succeeded', stdout: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(payload) } }),
  stderr: '', stdoutTruncated: false, stderrTruncated: false, telemetry: { usageAvailable: false },
})

describe('versioned live contract evidence', () => {
  it('rejects false-valued, ambiguous, and repeated billable options before any provider probe', () => {
    expect(parseOptions(['--agent=codex', '--live']).get('--live')).toBe(true)
    for (const args of [['--live=false'], ['--live=true'], ['--live', '--live'], ['--agent'], ['--model='], ['--out'], ['--agent=codex', '--agent=claude']]) {
      expect(() => parseOptions(args)).toThrow()
    }
    expect(parseOptions([]).has('--live')).toBe(false)
  })
  it('requires the exact returned result, a complete process, and unchanged inputs', () => {
    const valid = result({ schemaVersion: 1, nonce })
    expect(assessContract('codex', valid, nonce, true).status).toBe('passed')
    expect(assessContract('codex', { ...valid, kind: 'failed' }, nonce, true).status).toBe('failed')
    expect(assessContract('codex', { ...valid, stdoutTruncated: true }, nonce, true).status).toBe('failed')
    expect(assessContract('codex', valid, nonce, false).status).toBe('failed')
    expect(assessContract('codex', result({ schemaVersion: 1, nonce: 'other' }), nonce, true).status).toBe('failed')
    expect(assessContract('codex', result({ schemaVersion: 1, nonce, extra: true }), nonce, true).status).toBe('failed')
  })

  it('keeps unknown usage and untested enforcement separate from a benign output pass', () => {
    const report = assessContract('codex', result({ schemaVersion: 1, nonce }), nonce, true)
    expect(report.usage).toEqual({ status: 'unknown' })
    expect(report.permissionEnforcement).toBe('not-tested')
    expect(report.nestedAgentEnforcement).toBe('not-tested')
    expect(report.cancellationContract).toBe('not-tested')
    expect(report.reportedModels).toEqual([])
  })
})
