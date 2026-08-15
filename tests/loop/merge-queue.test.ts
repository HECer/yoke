import { describe, expect, it } from 'vitest'
import { MergeQueue } from '../../src/loop/merge-queue.js'
describe('merge queue', () => {
  it('serializes FIFO and re-verifies before integration', async () => {
    const order: string[] = []; const queue = new MergeQueue()
    const job = (id: string) => ({ storyId: id, rebase: () => { order.push(`rebase:${id}`) }, verify: () => { order.push(`verify:${id}`); return true }, integrate: () => { order.push(`integrate:${id}`) } })
    expect(await Promise.all([queue.enqueue(job('A')), queue.enqueue(job('B'))])).toEqual([
      { storyId: 'A', status: 'integrated', integrated: true },
      { storyId: 'B', status: 'integrated', integrated: true },
    ])
    expect(order).toEqual(['rebase:A', 'verify:A', 'integrate:A', 'rebase:B', 'verify:B', 'integrate:B'])
  })
  it('never integrates a failed verification and continues the queue', async () => {
    const queue = new MergeQueue(); let integrated = false
    expect((await queue.enqueue({ storyId: 'A', rebase: () => {}, verify: () => false, integrate: () => { integrated = true } })).integrated).toBe(false)
    expect(integrated).toBe(false)
  })
})
