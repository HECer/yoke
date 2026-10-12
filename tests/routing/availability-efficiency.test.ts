import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { makeAdaptiveRunner, makeAsyncAdaptiveRunner } from '../../src/routing/router.js'
import type { Agent, RoutingWorker } from '../../src/retrofit/config.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const workers: RoutingWorker[] = Array.from({ length: 24 }, (_, index) => ({
  id: `profile-${index}`, agent: index % 2 === 0 ? 'claude' : 'gemini', model: `model-${index}`,
  costTier: 'low', capabilities: ['typescript'],
}))

describe('routing availability probes', () => {
  for (const mode of ['sync', 'async'] as const) it(`${mode}: rechecks availability before dispatch after setup`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'yoke-availability-flip-'))
    let available = true, calls = 0
    const probes: Agent[] = []
    const options = { parent: 'claude' as const, workers, strategy: 'cost' as const, maxCandidates: 24,
      rules: [{ storyId: 'S1', worker: 'profile-0' }],
      isAvailable: (agent: Agent) => { probes.push(agent); return available },
      makeWorker: () => () => { calls++; return { success: true, summary: 'done' } },
    }
    try {
      const runner = mode === 'sync' ? makeAdaptiveRunner(options) : makeAsyncAdaptiveRunner({ ...options, makeWorker: () => async () => { calls++; return { success: true, summary: 'done' } } })
      assert.deepEqual(probes, ['claude', 'gemini'])
      available = false
      const result = await runner({ targetDir: root, story: { id: 'S1', title: 'Improve parser', priority: 1, acceptance: ['Keep parsing'], passes: false } })
      assert.equal(result.success, false)
      assert.match(result.summary, /unavailable/i)
      assert.equal(calls, 0)
      assert.deepEqual(probes, ['claude', 'gemini', 'claude'])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('checks each CLI once rather than once for every synchronous model profile', () => {
    const probes: Agent[] = []
    makeAdaptiveRunner({ parent: 'claude', workers, strategy: 'cost', maxCandidates: 24,
      isAvailable: agent => { probes.push(agent); return true },
    })
    assert.deepEqual(probes, ['claude', 'gemini'])
  })
  it('also deduplicates unavailable providers during asynchronous runner setup', () => {
    const probes: Agent[] = []
    makeAsyncAdaptiveRunner({ parent: 'claude', workers, strategy: 'cost', maxCandidates: 24,
      isAvailable: agent => { probes.push(agent); return false },
      makeWorker: () => async () => { throw new Error('must not execute during setup') },
      captureRoute: async () => { throw new Error('must not execute during setup') },
    })
    assert.deepEqual(probes, ['claude', 'gemini'])
  })
})
