export interface MergeJob {
  storyId: string
  rebase(): Promise<void> | void
  verify(): Promise<boolean> | boolean
  integrate(): Promise<void> | void
}

export interface MergeResult { storyId: string; integrated: boolean; reason?: string }

export class MergeQueue {
  private tail: Promise<unknown> = Promise.resolve()

  enqueue(job: MergeJob): Promise<MergeResult> {
    const run = async (): Promise<MergeResult> => {
      try {
        await job.rebase()
        if (!await job.verify()) return { storyId: job.storyId, integrated: false, reason: 'integrated-tree verification failed' }
        await job.integrate()
        return { storyId: job.storyId, integrated: true }
      } catch (error) {
        return { storyId: job.storyId, integrated: false, reason: (error as Error).message }
      }
    }
    const result = this.tail.then(run, run)
    this.tail = result.then(() => undefined)
    return result
  }
}
