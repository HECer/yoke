import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeAdaptiveRunner, makeAsyncAdaptiveRunner } from '../../src/routing/router.js'
import { readRoutingAttempts, routingAttemptSummary } from '../../src/routing/attempts.js'
import { routingAssessmentKey } from '../../src/routing/capability.js'
import type { Story } from '../../src/loop/prd.js'
import type { RoutingWorker } from '../../src/retrofit/config.js'

let root: string
const assessment = { taskClass: 'mechanical', difficulty: 'low', uncertainty: 'low', risk: 'low', scope: 'low', testability: 'high', reason: 'Known edit', approach: 'Edit and verify' } as const
const story: Story = { id: 'S1', title: 'Rename', priority: 1, acceptance: ['rename verified'], passes: false, assessment }
const workers: RoutingWorker[] = [{ id: 'small', agent: 'codex', model: 'small', tier: 'light', costTier: 'low', capabilities: ['mechanical'] }]
const options = { parent: 'codex', workers, strategy: 'capability', maxCandidates: 1, maxAttempts: 2 } as const
const measured = { inputTokens: 12, outputTokens: 3, totalCostUsd: 0.02, model: 'resolved-small' }
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'yoke-call-account-')); vi.stubEnv('YOKE_REGISTRY_DIR', join(root, 'registry')) })
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }) })
const attempts = (task = story) => readRoutingAttempts(root, task.id, routingAssessmentKey(root, task))

it('checks the remaining budget after paid planning and before creating or reserving a worker', () => {
  let plannerPaid = false
  const makeWorker = vi.fn(() => () => ({ success: true, summary: 'done' }))
  const onCallUsage = vi.fn()
  const task = { ...story, assessment: undefined }
  const run = makeAdaptiveRunner({ ...options, admitCall: () => plannerPaid ? 'Token budget exhausted' : undefined,
    captureRoute: () => { plannerPaid = true; return { success: true, summary: 'plan', output: `YOKE_ASSESS ${JSON.stringify(assessment)}`, tokens: measured } }, makeWorker, onCallUsage })
  const result = run({ targetDir: root, story: task })
  expect(result.routing?.blocked).toBe(true)
  expect(result.tokens).toMatchObject(measured)
  expect(makeWorker).not.toHaveBeenCalled()
  expect(attempts(task)).toHaveLength(0)
  expect(onCallUsage).toHaveBeenCalledTimes(1)
})

it('does not charge an attempt or emit a usage call when worker construction fails before execution', () => {
  const onCallUsage = vi.fn()
  const result = makeAdaptiveRunner({ ...options, onCallUsage, makeWorker: () => { throw Error('Missing local configuration') } })({ targetDir: root, story })
  expect(result.routing?.blocked).toBe(true)
  expect(attempts()).toHaveLength(0)
  expect(result.tokens).toBeUndefined()
  expect(onCallUsage).not.toHaveBeenCalled()
})

it.each(['block', 'tier'] as const)('retains a paid controller call when the selected parent is blocked by %s', mode => {
  const makeWorker = vi.fn(() => () => ({ success: true, summary: 'done' })), onCallUsage = vi.fn()
  const result = makeAdaptiveRunner({ ...options, strategy: 'cost', ...(mode === 'block' ? { fallback: 'block' as const } : { maxTier: 'light' as const }),
    captureRoute: () => ({ success: true, summary: 'route', output: 'YOKE_ROUTE {"worker":"SELF"}', tokens: measured }), makeWorker, onCallUsage })({ targetDir: root, story })
  expect(result.routing?.blocked).toBe(true)
  expect(result.tokens).toMatchObject(measured)
  expect(result.tokens?.calls).toHaveLength(1)
  expect(onCallUsage).toHaveBeenCalledTimes(1)
  expect(makeWorker).not.toHaveBeenCalled()
  expect(attempts()).toHaveLength(0)
})

it('retains malformed asynchronous planner usage without an implementation reservation', async () => {
  const onCallUsage = vi.fn(), makeWorker = vi.fn(() => async () => ({ success: true, summary: 'done' }))
  const task = { ...story, assessment: undefined }
  const result = await makeAsyncAdaptiveRunner({ ...options, onCallUsage, makeWorker,
    captureRoute: async () => ({ success: true, summary: 'invalid', output: 'not an assessment', tokens: measured }) })({ targetDir: root, story: task })
  expect(result.routing?.blocked).toBe(true)
  expect(result.tokens).toMatchObject(measured)
  expect(onCallUsage).toHaveBeenCalledTimes(1)
  expect(makeWorker).not.toHaveBeenCalled()
  expect(attempts(task)).toHaveLength(0)
})

it('delivers reported usage once even if the asynchronous provider throws', async () => {
  const onCallUsage = vi.fn()
  const result = await makeAsyncAdaptiveRunner({ ...options, onCallUsage, captureRoute: async () => { throw Error('Unexpected planner') },
    makeWorker: () => async () => { throw Object.assign(Error('Provider disconnected'), { tokens: { ...measured, callId: 'provider-call-id' } }) } })({ targetDir: root, story })
  expect(result.routing?.blocked).toBe(true)
  expect(result.tokens).toMatchObject(measured)
  expect(result.tokens?.calls?.[0].callId).toBe('provider-call-id')
  expect(onCallUsage).toHaveBeenCalledTimes(1)
  expect(onCallUsage.mock.calls[0][0].callId).toBe('provider-call-id')
  expect(attempts()[0].outcome).toMatchObject({ verificationSuccess: false, failureKind: 'infrastructure' })
})

it('still delivers paid usage when the routing usage journal cannot be written', () => {
  const onCallUsage = vi.fn()
  const result = makeAdaptiveRunner({ ...options, onCallUsage, makeWorker: () => () => {
    const reservation = attempts()[0].reservation
    const [task, contract, ordinal] = reservation.id.split('.')
    writeFileSync(join(root, '.yoke', 'routing-attempts', task, contract, `usage-${ordinal}`), 'not a directory')
    return { success: true, summary: 'paid', tokens: measured }
  } })({ targetDir: root, story })
  expect(result.routing?.blocked).toBe(true)
  expect(result.summary).toContain('Call accounting failed')
  expect(result.tokens).toMatchObject(measured)
  expect(onCallUsage).toHaveBeenCalledTimes(1)
  expect(onCallUsage.mock.calls[0][0].usage).toMatchObject(measured)
  expect(attempts()[0].outcome).toMatchObject({ failureKind: 'infrastructure' })
})

it('keeps measured output and closes the attempt conservatively when the usage callback throws', () => {
  const onCallUsage = vi.fn(() => { throw Error('External journal is unavailable') })
  const result = makeAdaptiveRunner({ ...options, onCallUsage, makeWorker: () => () => ({ success: true, summary: 'paid', tokens: measured }) })({ targetDir: root, story })
  expect(result.tokens).toMatchObject(measured)
  expect(result.routing?.blocked).toBe(true)
  expect(onCallUsage).toHaveBeenCalledTimes(1)
  const entry = attempts()[0]
  expect(entry.outcome).toMatchObject({ failureKind: 'infrastructure' })
  expect(routingAttemptSummary(root, entry.reservation).costComplete).toBe(false)
})

it('keeps parent fallback unverified until independent gates report their result', () => {
  const run = makeAdaptiveRunner({ ...options, workers: [], strategy: 'cost', makeWorker: () => () => ({ success: true, summary: 'done', tokens: measured }) })
  const result = run({ targetDir: root, story })
  expect(attempts()[0].outcome).toBeUndefined()
  result.routing?.recordOutcome(true)
  result.routing?.recordOutcome(false)
  expect(attempts()[0].outcome).toMatchObject({ verificationSuccess: true, failureKind: 'implementation' })
})

it('publishes the explicit-rule decision with the same role as its single measured call', () => {
  const onDecision = vi.fn()
  const result = makeAdaptiveRunner({ ...options, onDecision, rules: [{ storyId: story.id, worker: 'small' }],
    makeWorker: () => () => ({ success: true, summary: 'done', tokens: { ...measured, callId: 'goal-call' } }) })({ targetDir: root, story })
  expect(onDecision.mock.calls[0][1].profile).toBe('small')
  expect(result.tokens?.calls).toHaveLength(1)
  expect(result.tokens?.calls?.[0]).toMatchObject({ callId: 'goal-call', role: 'worker' })
})
