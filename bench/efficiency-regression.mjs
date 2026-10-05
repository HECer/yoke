import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { referencePacket, feedbackPacket } from '../dist/context/packet.js'
import { createVerificationSession } from '../dist/loop/verification-cache.js'
import { waitForLoop } from '../dist/loop/wait.js'

// Synthetic host checks. Character counts are not provider token measurements.
const samples = 5
const source = Array.from({ length: 100 }, (_, i) => `## Feature ${i}\n${'Reference detail. '.repeat(45)}`).join('\n')
const reference = referencePacket('plan.md', source, 'Feature 42')
const feedback = feedbackPacket('Failure detail. '.repeat(2000))
assert.ok(reference.length <= 6000)
assert.ok(feedback.length <= 2400)
const root = mkdtempSync(join(tmpdir(), 'yoke-efficiency-bench-'))
const durations = []
const handoffs = []
try {
  writeFileSync(join(root, 'source.txt'), 'stable source')
  for (let i = 0; i < samples; i++) {
    const session = createVerificationSession()
    let executions = 0
    const start = performance.now()
    for (let j = 0; j < 5; j++) session.run(root, 'controlled pure check', 'criterion', () => { executions++; return { passed: true, summary: 'passed' } })
    durations.push(performance.now() - start)
    assert.equal(executions, 1)
    assert.deepEqual(session.stats(), { executed: 1, reused: 4 })
  }
  mkdirSync(join(root, '.yoke'))
  const status = state => {
    const temporary = join(root, '.yoke/status.tmp')
    writeFileSync(temporary, JSON.stringify({ state, iteration: 1, progress: { passed: state === 'complete' ? 1 : 0, total: 1 } }))
    renameSync(temporary, join(root, '.yoke/loop-status.json'))
  }
  for (let i = 0; i < samples; i++) {
    status('running')
    const start = performance.now()
    const timer = setTimeout(() => status('complete'), 20)
    try {
      assert.equal((await waitForLoop(root, { timeoutMs: 1000 })).outcome, 'changed')
      handoffs.push(performance.now() - start)
    } finally { clearTimeout(timer) }
  }
} finally { rmSync(root, { recursive: true, force: true }) }
console.log(JSON.stringify({
  kind: 'synthetic-host-regression', node: process.version, platform: process.platform, samples,
  reference: { originalCharacters: source.length, packetCharacters: reference.length },
  feedback: { originalCharacters: 30000, packetCharacters: feedback.length },
  repeatedControlledChecks: { requestedPerSample: 5, executedPerSample: 1, reusedPerSample: 4,
    elapsedMilliseconds: durations, min: Math.min(...durations), max: Math.max(...durations) },
  eventHandoff: { modelCalls: 0, fixtureDelayMilliseconds: 20, elapsedMilliseconds: handoffs, min: Math.min(...handoffs), max: Math.max(...handoffs) },
  limits: 'No provider calls, billed tokens, real-project delivery quality, or end-to-end speedup measured. Identity overhead included. Reuse is opt-in for pure commands only.',
}, null, 2))
