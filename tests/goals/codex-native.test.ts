import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { executeCodexGoal, createNativeGoalTransport, NativeGoalUnavailableError, NativeGoalCleanupError, objectiveRevision } from '../../src/goals/codex-native.js'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
let isolatedState: string
beforeEach(() => { isolatedState = mkdtempSync(join(tmpdir(), 'yoke-native-state-')); vi.stubEnv('LOCALAPPDATA', isolatedState); vi.stubEnv('YOKE_STATE_DIR', join(isolatedState, 'state')); vi.stubEnv('YOKE_REGISTRY_DIR', join(isolatedState, 'registry')) })
afterEach(() => { rmSync(isolatedState, { recursive: true, force: true }); vi.unstubAllEnvs() })

function fixture(error?: { code: number; message: string }) {
  const calls: { method: string; params: any }[] = []
  let listener: (method: string, params: any) => void = () => {}
  let closed = false
  return { calls, get closed() { return closed }, transport: {
    onNotification(fn: typeof listener) { listener = fn },
    async request(method: string, params: any) {
      calls.push({ method, params })
      if (method === 'thread/start' || method === 'thread/resume') return { thread: { id: 'thread-1' } }
      if (method === 'thread/goal/get') return { goal: { objective: 'Build feature', status: 'paused', tokensUsed: 40 } }
      if (method === 'thread/goal/set') { if (error) throw Object.assign(new Error(error.message), error); return { goal: { status: params.status } } }
      if (method === 'turn/start') {
        queueMicrotask(() => { listener('thread/tokenUsage/updated', { threadId: 'thread-1', turnId: 'turn-1', tokenUsage: { last: { inputTokens: 12, outputTokens: 3 }, total: { inputTokens: 12, outputTokens: 3 } } }); listener('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } }) })
        return { turn: { id: 'turn-1' } }
      }
      return {}
    }, notify() {}, close() { closed = true },
  } }
}
const input = { root: process.cwd(), prompt: 'Implement', objective: 'Build feature', selection: {}, signal: new AbortController().signal }
describe('native Codex goals', () => {
  it('sets paused objective, runs one turn, pauses before returning independent-check result', async () => {
    const f = fixture(); const result = await executeCodexGoal({ ...input, tokenBudget: 100, transport: f.transport })
    expect(result.success).toBe(true); expect(result.tokens).toMatchObject({ inputTokens: 12, outputTokens: 3 })
    expect(f.calls.filter(c => c.method === 'thread/goal/set').map(c => c.params.status)).toEqual(['paused', 'paused'])
    expect(result.nativeBinding.objectiveRevision).toBe(objectiveRevision(input.objective)); expect(f.closed).toBe(true)
  })
  it('resumes bound thread and adds used native tokens to remaining budget', async () => {
    const f = fixture(); await executeCodexGoal({ ...input, binding: { provider: 'codex', threadId: 'thread-1', objectiveRevision: objectiveRevision(input.objective) }, tokenBudget: 100, transport: f.transport })
    expect(f.calls.some(c => c.method === 'thread/resume')).toBe(true)
    expect(f.calls.find(c => c.method === 'thread/goal/set')?.params.tokenBudget).toBe(140)
  })
  it('rejects stale objective before issuing requests', async () => {
    const f = fixture(); await expect(executeCodexGoal({ ...input, binding: { provider: 'codex', threadId: 'thread-1', objectiveRevision: 'wrong' }, transport: f.transport })).rejects.toThrow('objective')
    expect(f.calls).toHaveLength(0)
  })
  it('allows capability fallback only for missing native method', async () => {
    await expect(executeCodexGoal({ ...input, transport: fixture({ code: -32601, message: 'missing' }).transport })).rejects.toBeInstanceOf(NativeGoalUnavailableError)
    await expect(executeCodexGoal({ ...input, transport: fixture({ code: -32000, message: 'authentication failed' }).transport })).rejects.not.toBeInstanceOf(NativeGoalUnavailableError)
  })
  it('rejects pre-aborted work without touching transport', async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort()
    await expect(executeCodexGoal({ ...input, signal: controller.signal, transport: f.transport })).rejects.toThrow('cancelled'); expect(f.calls).toHaveLength(0)
  })
  it('bounds a stalled turn and closes transport', async () => {
    const f = fixture(); f.transport.request = async (method, params) => method === 'thread/start' ? { thread: { id: 'thread-1' } } : method === 'turn/start' ? { turn: { id: 'turn-1' } } : {}
    await expect(executeCodexGoal({ ...input, transport: f.transport, timeoutMs: 10 })).rejects.toThrow('timeout'); expect(f.closed).toBe(true)
  })
  it('interrupts an in-progress turn on cancellation', async () => {
    const f = fixture(); const controller = new AbortController()
    f.transport.request = async (method, params) => { f.calls.push({ method, params }); if (method === 'thread/start') return { thread: { id: 'thread-1' } }; if (method === 'turn/start') { setTimeout(() => controller.abort(), 10); return { turn: { id: 'turn-1' } } }; return {} }
    await expect(executeCodexGoal({ ...input, signal: controller.signal, transport: f.transport })).rejects.toThrow('cancelled')
    expect(f.calls.some(call => call.method === 'turn/interrupt')).toBe(true); expect(f.closed).toBe(true)
  })
  it('ignores stale completion replay before current turn response', async () => {
    const f = fixture(); const original = f.transport.request
    let listener: (method: string, params: any) => void = () => {}
    const register = f.transport.onNotification
    f.transport.onNotification = fn => { listener = fn; register(fn) }
    f.transport.request = async (method, params) => {
      if (method === 'turn/start') {
        listener('turn/completed', { threadId: 'thread-1', turn: { id: 'stale', status: 'completed' } })
        setTimeout(() => listener('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } }), 5)
        return { turn: { id: 'turn-1' } }
      }
      return original(method, params)
    }
    expect((await executeCodexGoal({ ...input, transport: f.transport })).success).toBe(true)
  })
  it('propagates unconfirmed cleanup instead of reporting a successful turn', async () => {
    const f = fixture(); f.transport.close = () => { throw new NativeGoalCleanupError() }
    await expect(executeCodexGoal({ ...input, transport: f.transport })).rejects.toMatchObject({ cleanupUnconfirmed: true })
  })
  it('rejects malformed JSON without exposing payload, disables multiagent and kills child', async () => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, kill() { return true } })
    let args: readonly string[] = []
    const transport = createNativeGoalTransport(process.cwd(), 50, ((_command: string, argv: readonly string[]) => { args = argv; return child }) as unknown as typeof spawn)
    const request = transport.request('initialize', {})
    child.stdout.write('{secret malformed\n')
    await expect(request).rejects.toThrow('Malformed'); expect(args).toContain('features.multi_agent=false'); expect(args).not.toContain('--ignore-user-config'); if (process.platform === 'win32') expect(args.some(arg => arg.startsWith('shell_environment_policy.set.PATH='))).toBe(true); transport.close()
  })
  it('rejects unsupported native bare startup before transport or model requests', async () => {
    const f = fixture(); await expect(executeCodexGoal({ ...input, selection: { bare: true }, transport: f.transport })).rejects.toThrow('do not support bare'); expect(f.calls).toHaveLength(0)
    expect(() => createNativeGoalTransport(process.cwd(), 50, (() => { throw new Error('must not spawn') }) as unknown as typeof spawn, { bare: true })).toThrow('do not support bare')
  })
  it('counts every model request from cumulative totals instead of only the latest increment', async () => {
    const f = fixture(); const register = f.transport.onNotification
    f.transport.onNotification = fn => register((method, params) => {
      if (method === 'thread/tokenUsage/updated') {
        fn(method, params)
        fn(method, { ...params, tokenUsage: { total: { inputTokens: 30, outputTokens: 8 }, last: { inputTokens: 18, outputTokens: 5 } } })
      } else fn(method, params)
    })
    const result = await executeCodexGoal({ ...input, transport: f.transport })
    expect(result.tokens).toMatchObject({ inputTokens: 30, outputTokens: 8 }); expect(result.nativeBinding.usageBaseline).toMatchObject({ inputTokens: 30, outputTokens: 8 })
  })
  it('subtracts the durable same-thread baseline and ignores repeated absolute snapshots', async () => {
    const f = fixture(); const register = f.transport.onNotification
    f.transport.onNotification = fn => register((method, params) => {
      if (method === 'thread/tokenUsage/updated') { const frame = { ...params, tokenUsage: { total: { inputTokens: 150, outputTokens: 30 }, last: { inputTokens: 12, outputTokens: 3 } } }; fn(method, frame); fn(method, frame) } else fn(method, params)
    })
    const result = await executeCodexGoal({ ...input, binding: { provider: 'codex', threadId: 'thread-1', objectiveRevision: objectiveRevision(input.objective), usageBaseline: { inputTokens: 100, outputTokens: 20 } }, transport: f.transport })
    expect(result.tokens).toMatchObject({ inputTokens: 50, outputTokens: 10 })
  })
  it('does not estimate zero when resumed binding has no durable usage baseline', async () => {
    const f = fixture(); const result = await executeCodexGoal({ ...input, binding: { provider: 'codex', threadId: 'thread-1', objectiveRevision: objectiveRevision(input.objective) }, transport: f.transport })
    expect(result.tokens).toBeUndefined()
    expect(result.nativeBinding.usageBaseline).toMatchObject({ inputTokens: 12, outputTokens: 3 })
  })
  it.each(['decreasing', 'malformed', 'missing'])('reports usage unknown for %s cumulative snapshots', async kind => {
    const f = fixture(); const register = f.transport.onNotification
    f.transport.onNotification = fn => register((method, params) => {
      if (method === 'thread/tokenUsage/updated') {
        fn(method, params)
        const total = kind === 'decreasing' ? { inputTokens: 10, outputTokens: 2 } : kind === 'malformed' ? { inputTokens: -1, outputTokens: 3 } : undefined
        fn(method, { ...params, tokenUsage: { total, last: { inputTokens: 12, outputTokens: 3 } } })
      } else fn(method, params)
    })
    expect((await executeCodexGoal({ ...input, transport: f.transport })).tokens).toBeUndefined()
  })
  it('rejects malformed durable usage before any RPC', async () => {
    const f = fixture(); await expect(executeCodexGoal({ ...input, binding: { provider: 'codex', threadId: 'thread-1', objectiveRevision: objectiveRevision(input.objective), usageBaseline: { inputTokens: -1, outputTokens: 0 } }, transport: f.transport })).rejects.toThrow('usage baseline'); expect(f.calls).toHaveLength(0)
  })
  it('keeps decreasing counters untrusted on later same-thread turns', async () => {
    const f = fixture(); const first = await executeCodexGoal({ ...input, binding: { provider: 'codex', threadId: 'thread-1', objectiveRevision: objectiveRevision(input.objective), usageBaseline: { inputTokens: 20, outputTokens: 4 } }, transport: f.transport })
    expect(first.tokens).toBeUndefined(); expect(first.nativeBinding.usageInvalid).toBe(true)
    const next = fixture(); const register = next.transport.onNotification
    next.transport.onNotification = fn => register((method, params) => fn(method, method === 'thread/tokenUsage/updated' ? { ...params, tokenUsage: { total: { inputTokens: 50, outputTokens: 10 } } } : params))
    const second = await executeCodexGoal({ ...input, binding: first.nativeBinding, transport: next.transport })
    expect(second.tokens).toBeUndefined(); expect(second.nativeBinding.usageInvalid).toBe(true)
  })
  it('streams cumulative turn deltas after buffered usage and ignores foreign turns', async () => {
    const f = fixture(); const register = f.transport.onNotification
    f.transport.onNotification = fn => register((method, params) => {
      if (method === 'turn/completed') {
        fn('thread/tokenUsage/updated', { threadId: 'thread-1', turnId: 'foreign', tokenUsage: { total: { inputTokens: 9999, outputTokens: 9999 } } })
        fn('thread/tokenUsage/updated', { threadId: 'foreign-thread', turnId: 'turn-1', tokenUsage: { total: { inputTokens: 9999, outputTokens: 9999 } } })
        setTimeout(() => {
          fn('thread/tokenUsage/updated', { threadId: 'thread-1', turnId: 'turn-1', tokenUsage: { total: { inputTokens: 30, outputTokens: 8 } } })
          fn(method, params)
        }, 5)
      } else fn(method, params)
    })
    const updates: { inputTokens: number; outputTokens: number }[] = []; let finals = 0
    const result = await executeCodexGoal({ ...input, transport: f.transport, onUsageUpdate: usage => updates.push(usage), onUsage: () => { finals++ } })
    expect(updates).toEqual([{ inputTokens: 12, outputTokens: 3 }, { inputTokens: 30, outputTokens: 8 }]); expect(finals).toBe(1); expect(result.tokens).toMatchObject(updates.at(-1)!)
  })
  it('does not stream malformed cumulative usage or a missing durable baseline', async () => {
    const f = fixture(); let updates = 0
    await executeCodexGoal({ ...input, binding: { provider: 'codex', threadId: 'thread-1', objectiveRevision: objectiveRevision(input.objective) }, transport: f.transport, onUsageUpdate: () => { updates++ } })
    expect(updates).toBe(0)
  })
  it('lets streamed usage cancel the known current turn before further work', async () => {
    const f = fixture(); const controller = new AbortController()
    await expect(executeCodexGoal({ ...input, signal: controller.signal, transport: f.transport, onUsageUpdate: measured => { if (measured.inputTokens + measured.outputTokens > 10) controller.abort('Token budget exceeded') } })).rejects.toThrow('cancelled')
    expect(f.calls.some(call => call.method === 'turn/interrupt')).toBe(true); expect(f.closed).toBe(true)
  })
  it('streams only valid snapshots and deduplicates repeated totals', async () => {
    const f = fixture(); const register = f.transport.onNotification
    f.transport.onNotification = fn => register((method, params) => {
      if (method === 'turn/completed') {
        setTimeout(() => {
          fn('thread/tokenUsage/updated', { threadId: 'thread-1', turnId: 'turn-1', tokenUsage: { total: { inputTokens: 12, outputTokens: 3 } } })
          fn('thread/tokenUsage/updated', { threadId: 'thread-1', turnId: 'turn-1', tokenUsage: { total: { inputTokens: -1, outputTokens: 3 } } })
          fn(method, params)
        }, 5)
      } else fn(method, params)
    })
    const updates: unknown[] = []; const result = await executeCodexGoal({ ...input, transport: f.transport, onUsageUpdate: usage => updates.push(usage) })
    expect(updates).toEqual([{ inputTokens: 12, outputTokens: 3 }]); expect(result.tokens).toBeUndefined()
  })
})
