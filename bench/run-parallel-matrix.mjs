import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { createDispatcher } from '../dist/loop/dispatcher.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/parallel-work/scenarios.json', import.meta.url), 'utf8'))
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function runCase(scenario, maxConcurrency) {
  let workerTimeMs = 0
  let integrationQueueWaitMs = 0
  let integrationTimeMs = 0
  const dispatcher = createDispatcher({
    targetDir: process.cwd(),
    stories: scenario.stories.map(story => ({ priority: 1, acceptance: [], passes: false, ...story })),
    maxConcurrency,
    maxIterations: Infinity,
    worker: async input => {
      const started = performance.now()
      await delay(fixture.workerDurationMs)
      workerTimeMs += performance.now() - started
      return {
        kind: 'candidate',
        storyId: input.story.id,
        worktree: input.worktree.path,
        baseCommit: input.worktree.baseCommit,
        provider: input.provider,
        summary: 'synthetic worker complete',
        evidence: { criteria: [], verify: { passed: true, summary: 'synthetic' } },
        routing: { outcome: 'pending-integration', recordOutcome() {} },
      }
    },
    claims: { acquire: () => true, heartbeat() {}, release: () => true },
    worktrees: {
      create: input => ({ path: `virtual/${input.story.id}`, baseCommit: `base-${input.story.id}` }),
      remove() {},
    },
    git: {
      isClean: () => true,
      rebase: () => ({ kind: 'rebased', expectedHead: 'synthetic-head' }),
      commit() {},
      integrate: async () => { await delay(fixture.integrationDurationMs) },
    },
    gates: { verify: () => ({ passed: true, summary: 'synthetic gate passed' }) },
    onIntegrationMetrics: (_worker, queueWait, integrationMs) => {
      if (integrationMs === undefined) integrationQueueWaitMs += queueWait
      else integrationTimeMs += integrationMs
    },
  })
  const started = performance.now()
  const result = await dispatcher.run()
  return {
    scenario: scenario.id,
    workers: maxConcurrency,
    wallMs: Math.round(performance.now() - started),
    workerMs: Math.round(workerTimeMs),
    queueWaitMs: Math.round(integrationQueueWaitMs),
    integrationMs: Math.round(integrationTimeMs),
    attempts: result.iterations,
    accepted: result.integrated.length,
    status: result.status,
  }
}

console.log('Synthetic dispatcher matrix; fixed local delays, no model calls or provider quality claims.')
console.log('scenario,workers,wall_ms,worker_ms,integration_queue_wait_ms,integration_ms,attempts,accepted,status')
for (const scenario of fixture.scenarios) {
  for (const workers of [1, 2, 3]) {
    const result = await runCase(scenario, workers)
    console.log([result.scenario, result.workers, result.wallMs, result.workerMs, result.queueWaitMs, result.integrationMs, result.attempts, result.accepted, result.status].join(','))
  }
}
