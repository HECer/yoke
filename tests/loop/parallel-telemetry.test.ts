import { describe, expect, it } from 'vitest'
import { providerProcessResultToAgentResult } from '../../src/loop/parallel-command.js'

const evidence = {
  invocation: { command: 'provider', args: [], input: '', cwd: '/tmp/project' },
  pid: 42,
  stdout: 'partial provider output',
  stderr: '',
  stdoutTruncated: false,
  stderrTruncated: false,
  telemetry: { usageAvailable: true, tokens: { inputTokens: 3, outputTokens: 5, model: 'provider-model' } },
}

describe('parallel provider telemetry', () => {
  it.each([
    [{ ...evidence, kind: 'succeeded' as const, exitCode: 0 }, true, 'codex implemented S1'],
    [{ ...evidence, kind: 'failed' as const, exitCode: 7 }, false, 'codex exited 7'],
    [{ ...evidence, kind: 'timed-out' as const, reason: 'idle timeout' }, false, 'idle timeout'],
    [{ ...evidence, kind: 'cancelled' as const, reason: 'decision requested' }, false, 'decision requested'],
    [{ ...evidence, kind: 'spawn-failed' as const, error: 'spawn ENOENT' }, false, 'spawn ENOENT'],
  ])('retains partial tokens for %s terminal result', (processResult, success, summary) => {
    const result = providerProcessResultToAgentResult('codex', 'S1', processResult)

    expect(result).toMatchObject({ success, summary, tokens: { inputTokens: 3, outputTokens: 5, model: 'provider-model' } })
  })
})
