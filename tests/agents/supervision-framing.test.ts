import { describe, it, vi } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSupervision } from '../../src/agents/supervision.js'

function supervised(run: (supervision: ReturnType<typeof createSupervision>, failures: string[], root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'yoke-framing-'))
  const failures: string[] = []
  const supervision = createSupervision(root, reason => failures.push(reason))
  try { run(supervision, failures, root) }
  finally { try { supervision.stop() } catch { /* deliberate storage failure */ } rmSync(root, { recursive: true, force: true }) }
}

describe('supervision stream boundaries', () => {
  it('does not interpret a discarded stdout frame suffix as a terminal error', () => supervised((supervision, failures) => {
    supervision.output('stdout', 'x'.repeat(262_145))
    supervision.output('stdout', '{"type":"error","error":"invalid api key"}\n')
    assert.deepEqual(failures, [])
    supervision.output('stdout', '{"type":"error","error":"invalid api key"}\n')
    assert.deepEqual(failures, ['provider-authentication-failed'])
  }))
  it('does not interpret a discarded stderr suffix as an authentication error', () => supervised((supervision, failures) => {
    supervision.output('stderr', 'x'.repeat(262_145))
    supervision.output('stderr', 'Error: authentication failed\n')
    assert.deepEqual(failures, [])
    supervision.output('stderr', 'Error: authentication failed\n')
    assert.deepEqual(failures, ['provider-authentication-failed'])
  }))
  it('flushes a final valid progress event without requiring a newline', () => supervised(supervision => {
    supervision.output('stdout', '{"type":"item.completed","item":{"type":"command_execution","exit_code":0}}')
    assert.equal(supervision.state.lastProgressAt, undefined)
    supervision.flush()
    assert.ok(supervision.state.lastProgressAt)
  }))
  it('reports a heartbeat storage failure rather than throwing out of a timer', () => {
    vi.useFakeTimers()
    try {
      supervised((supervision, failures, root) => {
        const directory = join(root, '.yoke', 'supervision')
        rmSync(directory, { recursive: true, force: true }); writeFileSync(directory, 'not a directory')
        vi.advanceTimersByTime(5000)
        assert.deepEqual(failures, ['provider-supervision-storage-failed'])
        assert.equal(supervision.state.state, 'stopping')
      })
    } finally { vi.useRealTimers() }
  })
})
