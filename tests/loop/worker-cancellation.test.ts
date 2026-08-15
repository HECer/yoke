import { describe, expect, it } from 'vitest'
import { bindStoryWorkerCancellation } from '../../src/loop/worker-cancellation.js'

describe('bindStoryWorkerCancellation', () => {
  it('forwards an AbortSignal reason to an active provider handle', () => {
    // Given: an active worker cancellation signal and a provider handle.
    const controller = new AbortController()
    const reasons: string[] = []

    // When: the worker is cancelled.
    bindStoryWorkerCancellation({ signal: controller.signal }, {
      cancel: reason => { reasons.push(reason); return true },
    })
    controller.abort('operator requested cancellation')

    // Then: the provider receives the worker's reason.
    expect(reasons).toEqual(['operator requested cancellation'])
  })

  it('disconnects cancellation when the process has already completed', () => {
    // Given: a bound cancellation signal that is disposed at process completion.
    const controller = new AbortController()
    const reasons: string[] = []
    const dispose = bindStoryWorkerCancellation({ signal: controller.signal }, {
      cancel: reason => { reasons.push(reason); return true },
    })

    // When: the handle finishes before the worker is cancelled.
    dispose()
    controller.abort('late cancellation')

    // Then: no completed process receives a late cancellation.
    expect(reasons).toEqual([])
  })
})
