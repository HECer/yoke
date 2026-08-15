export interface MergeJob<Prepared> {
  storyId: string
  rebase(): Promise<Prepared> | Prepared
  verify(prepared: Prepared): Promise<boolean> | boolean
  integrate(prepared: Prepared): Promise<void> | void
  postIntegrateVerify?(prepared: Prepared): Promise<void> | void
}

export type MergeResult =
  | { readonly storyId: string; readonly status: 'integrated'; readonly integrated: true }
  | { readonly storyId: string; readonly status: 'reopened'; readonly integrated: false; readonly reason: string }
  | { readonly storyId: string; readonly status: 'integrated-but-blocked'; readonly integrated: true; readonly reason: string }

export class MergeQueue {
  private tail: Promise<unknown> = Promise.resolve()

  enqueue<Prepared>(job: MergeJob<Prepared>): Promise<MergeResult> {
    const run = async (): Promise<MergeResult> => {
      try {
        const prepared = await job.rebase()
        if (!await job.verify(prepared)) return { storyId: job.storyId, status: 'reopened', integrated: false, reason: 'integrated-tree verification failed' }
        await job.integrate(prepared)
        try {
          await job.postIntegrateVerify?.(prepared)
          return { storyId: job.storyId, status: 'integrated', integrated: true }
        } catch (error) {
          return { storyId: job.storyId, status: 'integrated-but-blocked', integrated: true, reason: error instanceof Error ? error.message : String(error) }
        }
      } catch (error) {
        return { storyId: job.storyId, status: 'reopened', integrated: false, reason: error instanceof Error ? error.message : String(error) }
      }
    }
    const result = this.tail.then(run, run)
    this.tail = result.then(() => undefined)
    return result
  }
}
