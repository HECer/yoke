import test from 'node:test'
import assert from 'node:assert/strict'
import { TaskQueue } from '../src/task-queue.mjs'

const makeQueue = (options = {}) => {
  let now = 1_000
  const queue = new TaskQueue({ clock: () => now, maxAttempts: 2, baseDelayMs: 100, ...options })
  return { queue, now: () => now, advance: ms => { now += ms } }
}

test('fail requeues with exponential backoff and respects availability', () => {
  const { queue, now, advance } = makeQueue({ maxAttempts: 3 })
  const task = queue.enqueue({ type: 'work', payload: {} })
  queue.claim('worker')
  const first = queue.fail(task.id, 'worker', new Error('temporary'))
  assert.equal(first.status, 'queued')
  assert.equal(first.availableAt, now() + 100)
  assert.equal(queue.claim('early'), null)
  advance(100)
  queue.claim('worker')
  const second = queue.fail(task.id, 'worker', 'again')
  assert.equal(second.availableAt, now() + 200)
})

test('failure at maxAttempts moves a task to dead letters', () => {
  const { queue, advance } = makeQueue({ maxAttempts: 2 })
  const task = queue.enqueue({ type: 'work', payload: {} })
  queue.claim('worker')
  queue.fail(task.id, 'worker', 'first')
  advance(100)
  queue.claim('worker')
  const dead = queue.fail(task.id, 'worker', new Error('final'))
  assert.equal(dead.status, 'dead')
  assert.match(dead.error, /final/)
  assert.equal(queue.claim('other'), null)
})

test('reapExpired requeues only expired active leases', () => {
  const { queue, advance } = makeQueue()
  const first = queue.enqueue({ type: 'a', payload: {}, priority: 2 })
  queue.enqueue({ type: 'b', payload: {}, priority: 1 })
  queue.claim('worker-a', { leaseMs: 50 })
  queue.claim('worker-b', { leaseMs: 500 })
  advance(51)
  assert.equal(queue.reapExpired(), 1)
  assert.equal(queue.get(first.id).status, 'queued')
  assert.equal(queue.claim('worker-c').id, first.id)
})

test('list filters by status and type and stats reports every state', () => {
  const { queue } = makeQueue({ maxAttempts: 1 })
  const completed = queue.enqueue({ type: 'email', payload: {} })
  queue.claim('a')
  queue.complete(completed.id, 'a', 'ok')
  const dead = queue.enqueue({ type: 'email', payload: {} })
  queue.claim('b')
  queue.fail(dead.id, 'b', 'bad')
  queue.enqueue({ type: 'report', payload: {} })
  assert.equal(queue.list({ type: 'email' }).length, 2)
  assert.equal(queue.list({ status: 'dead' }).length, 1)
  assert.deepEqual(queue.stats(), { total: 3, queued: 1, active: 0, completed: 1, dead: 1 })
})

test('invalid identifiers, owners, and transitions are rejected', () => {
  const { queue } = makeQueue()
  assert.throws(() => queue.claim(''), /worker/i)
  assert.throws(() => queue.fail('missing', 'worker', 'x'), /task|missing|unknown/i)
  const task = queue.enqueue({ type: 'work', payload: {} })
  assert.throws(() => queue.fail(task.id, 'worker', 'x'), /state|active|queued/i)
  queue.claim('owner')
  assert.throws(() => queue.fail(task.id, 'intruder', 'x'), /worker|owner|lease/i)
})
