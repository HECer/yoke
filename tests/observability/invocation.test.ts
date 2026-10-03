import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readEvents } from '../../src/observability/events.js'
import { readMeasurements } from '../../src/observability/history.js'
import { measureInvocation } from '../../src/observability/invocation.js'
import { providerTelemetryUsage } from '../../src/observability/usage.js'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'yoke-invocation-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })
const invocation = { command: 'stub', args: [], input: 'do work', cwd: '.' }

it('records known consumption and requested versus actual models once per invocation', () => {
  const result = measureInvocation({ root, agent: 'codex', role: 'planner', storyId: 'draft', selection: { model: 'requested' }, invocation,
    execute: () => ({ success: true, summary: 'ok', tokens: { inputTokens: 100, outputTokens: 20, model: 'actual', totalCostUsd: 0.01 } }),
  })
  expect(result.success).toBe(true)
  const events = readEvents(root).filter(event => event.type === 'tokens')
  expect(events).toHaveLength(1)
  expect(events[0].data).toMatchObject({ inputTokens: 100, outputTokens: 20, model: 'actual', requestedModel: 'requested', role: 'planner', usageAvailable: true })
  expect(events[0].attemptId).toBeTruthy()
})

it('records an unknown paid attempt when a runner throws and propagates the original error', () => {
  const error = new Error('provider crashed')
  expect(() => measureInvocation({ root, agent: 'claude', role: 'coverage-review', invocation, execute: () => { throw error } })).toThrow(error)
  const event = readEvents(root).find(item => item.type === 'tokens')!
  expect(event.outcome).toBe('failed')
  expect(event.data).toMatchObject({ usageAvailable: false, measurementComplete: false })
  expect(event.data?.totalCostUsd).toBeUndefined()
})

it('retains partial known usage without presenting it as a complete or zero-cost call', () => {
  expect(providerTelemetryUsage({ usageAvailable: false, partialUsage: { inputTokens: 17, totalCostUsd: 0.02 } })).toMatchObject({ inputTokens: 17, outputTokens: 0, totalCostUsd: 0.02, measurementComplete: false, costMeasurementComplete: false })
  expect(providerTelemetryUsage({ usageAvailable: true, tokens: { inputTokens: 30, outputTokens: 4 }, partialUsage: { totalCostUsd: 0.01 } })).toMatchObject({ inputTokens: 30, outputTokens: 4, totalCostUsd: 0.01, measurementComplete: true, costMeasurementComplete: false })
  expect(providerTelemetryUsage({ usageAvailable: false })).toBeUndefined()
  expect(providerTelemetryUsage({ usageAvailable: false, partialUsage: { inputTokens: 17 }, reportedModels: ['actual'] })).toMatchObject({ model: 'actual', measurementComplete: false })
})

it('salvages multiline partial telemetry on throw and archives call identity and coverage', () => {
  const error = Object.assign(new Error('stream interrupted'), { stdout: Buffer.from('{"type":"thread.started"}\n{"model":"actual","usage":{"input_tokens":17}}\n') })
  const from = Date.now() - 1000
  expect(() => measureInvocation({ root, agent: 'codex', role: 'planner', parentCallId: 'parent', selection: { provider: 'api', model: 'requested', reasoningEffort: 'low', variant: 'fast' }, invocation, execute: () => { throw error } })).toThrow(error)
  const recent = readEvents(root).find(event => event.type === 'tokens')!
  expect(recent.data).toMatchObject({ actualModel: 'actual', inputTokens: 17, measurementComplete: false, usageAvailable: false, costMeasurementComplete: false })
  rmSync(join(root, '.yoke', 'events'), { recursive: true })
  const archived = readMeasurements(root, from, Date.now() + 1000)
  expect(archived.errors).toEqual([])
  expect(archived.events).toHaveLength(1)
  expect(archived.events[0].data).toMatchObject({ callId: recent.data!.callId, parentCallId: 'parent', requestedProvider: 'api', requestedModel: 'requested', requestedReasoningEffort: 'low', requestedVariant: 'fast', actualModel: 'actual', measurementComplete: false, costMeasurementComplete: false })
  expect(archived.events[0].data?.totalCostUsd).toBeUndefined()
})

it('does not replace the provider failure when its stdout cannot be read', () => {
  const error = Object.defineProperty(new Error('original failure'), 'stdout', { get: () => { throw new Error('bad stdout getter') } })
  expect(() => measureInvocation({ root, agent: 'codex', role: 'planner', invocation, execute: () => { throw error } })).toThrow(error)
  expect(readEvents(root).find(event => event.type === 'tokens')?.data).toMatchObject({ measurementComplete: false, costMeasurementComplete: false })
})
