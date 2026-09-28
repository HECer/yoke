import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PoolRequest } from '../../src/loop/resource-pool.js'

vi.mock('../../src/agents/process-incarnation.js', () => ({ processIncarnation: () => 'test-process:1' }))

let root: string
let previousLocalAppData: string | undefined
let previousLimit: string | undefined
let pool: typeof import('../../src/loop/resource-pool.js')

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'yoke-resource-pool-'))
  previousLocalAppData = process.env.LOCALAPPDATA
  previousLimit = process.env.YOKE_MAX_PARALLEL_WORKERS
  process.env.LOCALAPPDATA = root
  process.env.YOKE_MAX_PARALLEL_WORKERS = '2'
  vi.resetModules()
  pool = await import('../../src/loop/resource-pool.js')
})

afterEach(() => {
  if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA
  else process.env.LOCALAPPDATA = previousLocalAppData
  if (previousLimit === undefined) delete process.env.YOKE_MAX_PARALLEL_WORKERS
  else process.env.YOKE_MAX_PARALLEL_WORKERS = previousLimit
  rmSync(root, { recursive: true, force: true })
})

function request(storyId: string, units = 1, signal?: AbortSignal): PoolRequest {
  return {
    targetDir: join(root, 'project'),
    storyId,
    provider: 'codex',
    role: 'implementation',
    units,
    ...(signal ? { signal } : {}),
  }
}

describe('shared worker pool', () => {
  it('waits at the shared weighted limit and admits work after an owner releases its lease', async () => {
    const owner = await pool.acquireSharedWorker(request('owner', 2))
    const waiting = pool.acquireSharedWorker(request('waiting'))

    expect(pool.sharedPoolStatus()).toMatchObject({ limit: 2, activeUnits: 2, waitingWorkers: 1 })
    expect(await owner.release()).toBe(true)

    const next = await waiting
    expect(pool.sharedPoolStatus()).toMatchObject({ activeUnits: 1, activeWorkers: 1, waitingWorkers: 0 })
    expect(await next.release()).toBe(true)
    expect(pool.sharedPoolStatus()).toMatchObject({ activeUnits: 0, activeWorkers: 0 })
  })

  it('bounds FIFO overtakes so a light request cannot permanently starve a weighted request', async () => {
    const owner = await pool.acquireSharedWorker(request('owner'))
    const heavy = pool.acquireSharedWorker(request('heavy', 2))
    expect(pool.sharedPoolStatus().waitingWorkers).toBe(1)
    const light = await pool.acquireSharedWorker(request('light'))

    expect(pool.sharedPoolStatus()).toMatchObject({ activeUnits: 2, waitingWorkers: 1 })
    await owner.release()
    expect(pool.sharedPoolStatus()).toMatchObject({ activeUnits: 1, waitingWorkers: 1 })
    await light.release()

    const heavyLease = await heavy
    expect(pool.sharedPoolStatus()).toMatchObject({ activeUnits: 2, waitingWorkers: 0 })
    await heavyLease.release()
  })

  it('removes an aborted waiter without disturbing active work', async () => {
    const owner = await pool.acquireSharedWorker(request('owner', 2))
    const controller = new AbortController()
    const waiting = pool.acquireSharedWorker(request('cancelled', 1, controller.signal))
    expect(pool.sharedPoolStatus().waitingWorkers).toBe(1)

    controller.abort('operator stop')
    await expect(waiting).rejects.toThrow('operator stop')
    expect(pool.sharedPoolStatus()).toMatchObject({ activeUnits: 2, waitingWorkers: 0 })
    await owner.release()
  })

  it('releases synchronous leases even when the protected operation throws', () => {
    expect(() => pool.withSharedWorkerSync(request('legacy'), () => { throw new Error('runner failed') })).toThrow('runner failed')
    expect(pool.sharedPoolStatus()).toMatchObject({ activeUnits: 0, waitingWorkers: 0 })
  })

  it('stores only hashed project and story identifiers in pool records', async () => {
    const lease = await pool.acquireSharedWorker({ ...request('Private story title'), targetDir: join(root, 'Secret project path') })
    const poolDirectory = join(root, 'Yoke', 'parallel-pool')
    const record = readFileSync(join(poolDirectory, readdirSync(poolDirectory).find(name => name.startsWith('worker-'))!), 'utf8')

    expect(record).not.toContain('Secret project path')
    expect(record).not.toContain('Private story title')
    expect(JSON.parse(record)).toMatchObject({ project: expect.stringMatching(/^[a-f0-9]{16}$/u), storyId: expect.stringMatching(/^[a-f0-9]{16}$/u) })
    await lease.release()
  })

  it('fails closed when a pool ownership record is malformed', async () => {
    const directory = join(root, 'Yoke', 'parallel-pool')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'worker-00000000-0000-4000-8000-000000000001.json'), '{broken')

    expect(() => pool.sharedPoolStatus()).toThrow('Unreadable Yoke worker-pool record')
    await expect(pool.acquireSharedWorker(request('blocked'))).rejects.toThrow('Unreadable Yoke worker-pool record')
  })
})
