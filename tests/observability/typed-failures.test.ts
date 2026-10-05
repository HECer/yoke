import { expect, it } from 'vitest'
import { executionFailure, failureObservation, observedError, safeFailure } from '../../src/observability/failure.js'

it('maps the Node assertion code without inspecting diagnostic text', () => {
  expect(executionFailure(Object.assign(new Error('private assertion'), { code: 'ERR_ASSERTION' })))
    .toMatchObject({ failureCategory: 'product', failureCause: 'assertion' })
  expect(executionFailure(new Error('ENOENT assertion timeout'))).toMatchObject({ failureCause: 'unknown' })
})

it.each(['invalid-cwd', 'missing-executable', 'preflight'] as const)('preserves bounded pre-model %s evidence', cause => {
  const error = observedError('private cwd and environment', cause, 'not-started')
  const observation = executionFailure(error)
  expect(observation).toMatchObject({ failureCategory: 'infrastructure', failureCause: cause, modelExecution: 'not-started' })
  expect(JSON.stringify(observation)).not.toContain('private')
})

it('discards arbitrary failure metadata while preserving only valid execution stages', () => {
  const observation = failureObservation('spawn', 'not-started')
  expect(safeFailure({ ...observation, diagnostic: 'private', cwd: 'private' })).toEqual(observation)
  expect(safeFailure({ ...observation, modelExecution: 'private' })?.modelExecution).toBeUndefined()
  expect(safeFailure({ ...observation, modelExecution: { toString: () => 'not-started' } })?.modelExecution).toBeUndefined()
  expect(safeFailure({ ...observation, failureCategory: 'product' })).toBeUndefined()
})
