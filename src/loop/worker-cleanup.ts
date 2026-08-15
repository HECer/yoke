import type { DispatcherWorkerInput } from './dispatcher.js'

export type WorkerCleanupSteps = {
  readonly cleanupProcess?: (input: DispatcherWorkerInput) => void
  readonly removeWorktree: (input: DispatcherWorkerInput) => void
  readonly releaseClaim: (input: DispatcherWorkerInput) => void
}

export function createWorkerCleanup(steps: WorkerCleanupSteps): (input: DispatcherWorkerInput) => void {
  const completedByWorker = new WeakMap<DispatcherWorkerInput, Set<number>>()
  const orderedSteps = [steps.cleanupProcess ?? (() => undefined), steps.removeWorktree, steps.releaseClaim] as const
  return input => {
    const completed = completedByWorker.get(input) ?? new Set<number>()
    completedByWorker.set(input, completed)
    for (const [index, step] of orderedSteps.entries()) {
      if (completed.has(index)) continue
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          step(input)
          completed.add(index)
          break
        } catch (error) {
          if (attempt === 1) throw error instanceof Error ? error : new Error(String(error))
        }
      }
    }
  }
}
