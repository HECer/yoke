import type { ProviderProcessHandle } from '../agents/process.js'
import type { StoryWorkerCancellation } from './worker-contracts.js'

export function bindStoryWorkerCancellation(cancellation: StoryWorkerCancellation | undefined, handle: Pick<ProviderProcessHandle, 'cancel'>): () => void {
  const signal = cancellation?.signal
  if (!signal) return () => {}
  const cancel = (): void => {
    const reason = typeof signal.reason === 'string' && signal.reason.length > 0
      ? signal.reason
      : 'worker cancellation requested'
    handle.cancel(reason)
  }
  if (signal.aborted) {
    cancel()
    return () => {}
  }
  signal.addEventListener('abort', cancel, { once: true })
  return () => signal.removeEventListener('abort', cancel)
}
