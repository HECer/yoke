import test from 'node:test'
import assert from 'node:assert/strict'
import { TaskQueue } from '../src/task-queue.mjs'

const makeQueue = () => {
  let now = 1_000
  const queue = new TaskQueue({ clock: () => now, maxAttempts: 2, baseDelayMs: 100 })
  return { queue, setNow: value => { now = value } }
}

test('enqueue validates type and creates stable immutable snapshots', () => {
  const { queue } = makeQueue()
  assert.throws(() => queue.enqueue({ type: '', payload: {} }), /type/i)
  const task = queue.enqueue({ type: 'email', payload: { to: 'a@example.test' } })
  assert.equal(task.status, 'queued')
  assert.equal(task.priority, 0)
  assert.equal(task.createdAt, 1_000)
  assert.throws(() => { task.status = 'dead' }, TypeError)
  task.payload.to = 'changed@example.test'
  assert.equal(queue.get(task.id).payload.to, 'a@example.test')
})

test('idempotency keys return the original task without growing the queue', () => {
  const { queue } = makeQueue()
  const first = queue.enqueue({ type: 'email', payload: { n: 1 }, idempotencyKey: 'order-7' })
  const second = queue.enqueue({ type: 'email', payload: { n: 2 }, idempotencyKey: 'order-7' })
  assert.equal(second.id, first.id)
  assert.equal(second.payload.n, 1)
  assert.equal(queue.list().length, 1)
})

test('claim selects priority first and FIFO for ties', () => {
  const { queue, setNow } = makeQueue()
  const low = queue.enqueue({ type: 'low', payload: {}, priority: 1 })
  setNow(1_001)
  const highFirst = queue.enqueue({ type: 'high-a', payload: {}, priority: 5 })
  setNow(1_002)
  const highSecond = queue.enqueue({ type: 'high-b', payload: {}, priority: 5 })
  assert.equal(queue.claim('worker-1', { leaseMs: 50 }).id, highFirst.id)
  assert.equal(queue.claim('worker-2', { leaseMs: 50 }).id, highSecond.id)
  assert.equal(queue.claim('worker-3', { leaseMs: 50 }).id, low.id)
  assert.equal(queue.claim('worker-4'), null)
})

test('claim records lease ownership and complete enforces it', () => {
  const { queue } = makeQueue()
  const original = queue.enqueue({ type: 'work', payload: {} })
  const claimed = queue.claim('worker-a', { leaseMs: 250 })
  assert.equal(claimed.attempts, 1)
  assert.equal(claimed.workerId, 'worker-a')
  assert.equal(claimed.leaseUntil, 1_250)
  assert.throws(() => queue.complete(original.id, 'worker-b', 42), /worker|owner|lease/i)
  const done = queue.complete(original.id, 'worker-a', { ok: true })
  assert.equal(done.status, 'completed')
  assert.deepEqual(done.result, { ok: true })
  assert.throws(() => queue.complete(original.id, 'worker-a', {}), /state|active|completed/i)
})

test('get/list snapshots cannot mutate internal state', () => {
  const { queue } = makeQueue()
  const task = queue.enqueue({ type: 'work', payload: { nested: { value: 1 } } })
  const listed = queue.list()
  listed[0].payload.nested.value = 9
  listed.length = 0
  assert.equal(queue.get(task.id).payload.nested.value, 1)
  assert.equal(queue.list().length, 1)
  assert.equal(queue.get('missing'), null)
})
