import { createHash } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { providerSpawnOptions } from '../agents/process.js'
import type { ModelSelection } from '../agents/contracts.js'
import type { GoalExecutionResult } from './command.js'
import type { TokenUsage } from '../loop/reporter.js'
import { createProviderProcessRecord, filesystemProviderProcessRecordAdapter } from '../agents/process-record.js'
import { trackProcessRecordIdentity } from '../agents/process-record-identity.js'
import { resolve } from 'node:path'
import { windowsShellEnvironment } from '../agents/windows-launch.js'

export type NativeGoalStatus = 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete'
export interface NativeUsageBaseline { inputTokens: number; outputTokens: number; cachedInputTokens?: number; cacheWriteInputTokens?: number; reasoningOutputTokens?: number }
export interface NativeGoalBinding { provider: 'codex'; threadId: string; objectiveRevision: string; modelProvider?: string; model?: string; usageBaseline?: NativeUsageBaseline; usageInvalid?: true }
export interface NativeGoalTransport {
  request(method: string, params: Record<string, unknown>): Promise<any>
  notify(method: string, params?: Record<string, unknown>): void
  onNotification(listener: (method: string, params: any) => void): void
  close(): void | Promise<void>
}
export class NativeGoalUnavailableError extends Error { constructor() { super('Codex native goal methods are unavailable'); this.name = 'NativeGoalUnavailableError' } }
export class NativeGoalCleanupError extends Error { readonly cleanupUnconfirmed = true; constructor(readonly cleanupConfirmed?: Promise<void>) { super('Codex native process cleanup could not be confirmed; retain its provider permit'); this.name = 'NativeGoalCleanupError' } }
export const objectiveRevision = (objective: string): string => createHash('sha256').update(objective).digest('hex')
export interface NativeGoalInput {
  root: string; prompt: string; selection: ModelSelection; signal: AbortSignal; objective: string; tokenBudget?: number
  binding?: NativeGoalBinding; onBinding?: (binding: NativeGoalBinding) => void | Promise<void>
  onUsage?: (usage: TokenUsage) => void
  /** Measured cumulative usage for this turn, suitable for live budget comparison. */
  onUsageUpdate?: (usage: TokenUsage) => void
  transport?: NativeGoalTransport; timeoutMs?: number
}
function validateBinding(binding: NativeGoalBinding | undefined, objective: string, selection?: ModelSelection): void {
  if (binding && (binding.provider !== 'codex' || binding.objectiveRevision !== objectiveRevision(objective))) throw new Error('Native goal binding objective or provider mismatch')
  if (binding && selection && (binding.model !== selection.model || binding.modelProvider !== selection.provider)) throw new Error('Native goal binding model or model provider mismatch')
  if (binding?.usageBaseline && !parseUsage(binding.usageBaseline)) throw new Error('Malformed native usage baseline')
  if (binding?.usageInvalid !== undefined && binding.usageInvalid !== true) throw new Error('Malformed native usage trust state')
}
const usageFields = ['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'reasoningOutputTokens'] as const
function parseUsage(value: any): NativeUsageBaseline | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  if (!Number.isSafeInteger(value.inputTokens) || value.inputTokens < 0 || !Number.isSafeInteger(value.outputTokens) || value.outputTokens < 0) return undefined
  const result: NativeUsageBaseline = { inputTokens: value.inputTokens, outputTokens: value.outputTokens }
  for (const field of usageFields.slice(2)) { if (value[field] !== undefined) { if (!Number.isSafeInteger(value[field]) || value[field] < 0) return undefined; result[field] = value[field] } }
  return result
}
function nondecreasing(current: NativeUsageBaseline, previous: NativeUsageBaseline): boolean {
  return usageFields.every(field => previous[field] === undefined || ((current[field] ?? 0) >= previous[field]!))
}
function usageDelta(current: NativeUsageBaseline, previous: NativeUsageBaseline): TokenUsage {
  const result: TokenUsage = { inputTokens: current.inputTokens - previous.inputTokens, outputTokens: current.outputTokens - previous.outputTokens }
  for (const field of usageFields.slice(2)) if (current[field] !== undefined) result[field] = current[field]! - (previous[field] ?? 0)
  return result
}
async function goalRequest(transport: NativeGoalTransport, method: string, params: Record<string, unknown>): Promise<any> {
  try { return await transport.request(method, params) }
  catch (error) { if ((error as { code?: number }).code === -32601) throw new NativeGoalUnavailableError(); throw error }
}

/** A private stdio app-server. No protocol payloads or stderr are copied into logs. */
export function createNativeGoalTransport(root: string, timeoutMs = 30_000, spawnChild: typeof spawn = spawn, config: { bare?: boolean } = {}): NativeGoalTransport {
  if (config.bare) throw new Error('Native Codex goals do not support bare startup: app-server cannot ignore user config; use Codex exec for bare mode')
  const shellEnvironment = process.platform === 'win32' ? windowsShellEnvironment() : { env: process.env }
  const options = providerSpawnOptions({ command: 'codex', args: ['app-server', '--stdio', '--enable', 'goals', '-c', 'features.multi_agent=false', ...(process.platform === 'win32' ? ['-c', `shell_environment_policy.set.PATH=${JSON.stringify(shellEnvironment.env.PATH)}`] : [])], cwd: root, input: '' })
  const child = spawnChild(options.command, [...options.args], { cwd: root, shell: false, detached: options.detached, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: shellEnvironment.env }) as ChildProcessWithoutNullStreams
  const record = child.pid ? createProviderProcessRecord(resolve(root), child.pid, 'native-goal', `unverified:${new Date().toISOString()}`) : undefined
  if (record) { try { filesystemProviderProcessRecordAdapter.publish(record) } catch (error) { child.kill('SIGKILL'); throw error } }
  const cancelIdentity = trackProcessRecordIdentity(record, child)
  let next = 1, buffer = '', closed = false, exited = false, treeStopped = process.platform !== 'win32'
  let confirmCleanup = (): void => {}
  let resolveConfirmed = (): void => {}
  const cleanupConfirmed = new Promise<void>(resolveValue => { resolveConfirmed = resolveValue })
  let listener: (method: string, params: any) => void = () => {}
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  const fail = (error: Error): void => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error) }; pending.clear(); listener('yoke/transportFailure', {}) }
  const write = (value: unknown): void => { if (closed) throw new Error('Codex native transport closed'); child.stdin.write(JSON.stringify(value) + '\n') }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk
    if (Buffer.byteLength(buffer) > 1_048_576) { fail(new Error('Codex native protocol output exceeded limit')); void close().catch(() => {}); return }
    let index: number
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1)
      if (!line.trim()) continue
      try {
        const message = JSON.parse(line)
        if (!message || typeof message !== 'object') throw new Error('Malformed Codex native protocol reply')
        if (message.method && message.id !== undefined) { write({ id: message.id, error: { code: -32601, message: 'Yoke does not permit interactive server requests' } }); continue }
        if (typeof message.method === 'string') { listener(message.method, message.params); continue }
        const item = pending.get(message.id)
        if (!item) continue
        pending.delete(message.id); clearTimeout(item.timer)
        if (message.error) item.reject(Object.assign(new Error('Codex native RPC failed'), { code: message.error.code }))
        else if ('result' in message) item.resolve(message.result)
        else item.reject(new Error('Malformed Codex native protocol reply'))
      } catch { fail(new Error('Malformed Codex native protocol reply')); void close().catch(() => {}); return }
    }
  })
  child.stderr.resume()
  child.on('error', () => fail(new Error('Codex native app-server could not start')))
  child.on('close', () => { exited = true; cancelIdentity(); if (!closed || treeStopped) { if (record) filesystemProviderProcessRecordAdapter.remove(record.path); resolveConfirmed() }; confirmCleanup(); fail(new Error('Codex native app-server exited')) })
  child.stdin.on('error', () => fail(new Error('Codex native app-server input closed')))
  let cleanup: Promise<void> | undefined
  function close(): Promise<void> {
    if (cleanup) return cleanup
    cleanup = exited || !child.pid ? Promise.resolve() : new Promise((resolveCleanup, rejectCleanup) => { const bound = setTimeout(() => rejectCleanup(new NativeGoalCleanupError(cleanupConfirmed)), process.platform === 'win32' ? 15000 : 5000); confirmCleanup = () => { if (exited && treeStopped) { clearTimeout(bound); if (record) filesystemProviderProcessRecordAdapter.remove(record.path); resolveConfirmed(); resolveCleanup() } } })
    closed = true; fail(new Error('Codex native transport closed'))
    // Terminate the exact owned process and its descendants, without synchronous waits.
    if (child.pid && child.exitCode === null) {
      if (process.platform === 'win32') { const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); killer.on('error', () => {}); killer.on('close', code => { treeStopped = code === 0; confirmCleanup() }); killer.unref() }
      else { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }
      if (process.platform !== 'win32') child.kill('SIGKILL')
    }
    if (!child.pid || exited) child.stdin.end()
    return cleanup
  }
  return {
    request(method, params) { return new Promise((resolve, reject) => { const id = next++; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Codex native RPC timeout: ${method}`)) }, timeoutMs); pending.set(id, { resolve, reject, timer }); try { write({ id, method, params }) } catch (error) { pending.delete(id); clearTimeout(timer); reject(error) } }) },
    notify(method, params) { write({ method, params }) }, onNotification(fn) { listener = fn }, close,
  }
}
async function initialize(transport: NativeGoalTransport): Promise<void> {
  await transport.request('initialize', { clientInfo: { name: 'yoke', version: '1' }, capabilities: { experimentalApi: true } }); transport.notify('initialized')
}
function nativeGoal(response: any, objective: string): any {
  const goal = response?.goal
  if (!goal || goal.objective !== objective || !['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete'].includes(goal.status)) throw new Error('Native goal objective or status mismatch')
  return goal
}
export async function executeCodexGoal(input: NativeGoalInput): Promise<GoalExecutionResult & { nativeBinding: NativeGoalBinding; nativeStatus: NativeGoalStatus; nativeObservedStatus: NativeGoalStatus; nativeTokensUsed?: number }> {
  if (input.selection.bare) throw new Error('Native Codex goals do not support bare startup: app-server cannot ignore user config; use Codex exec for bare mode')
  validateBinding(input.binding, input.objective, input.selection)
  if (input.signal.aborted) throw new Error('Native goal execution cancelled')
  if (input.tokenBudget !== undefined && (!Number.isSafeInteger(input.tokenBudget) || input.tokenBudget <= 0)) throw new Error('Native goal remaining token budget must be positive')
  const transport = input.transport ?? createNativeGoalTransport(input.root, undefined, undefined, { bare: input.selection.bare })
  let threadId = input.binding?.threadId, turnId: string | undefined, usage: TokenUsage | undefined
  const baseline: NativeUsageBaseline | undefined = input.binding ? input.binding.usageBaseline : { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, reasoningOutputTokens: 0 }
  const completedTurns = new Map<string, any>(), turnUsage = new Map<string, { total?: NativeUsageBaseline; invalid: boolean; decreased: boolean }>()
  let lastUsageUpdate: string | undefined
  const publishUsageUpdate = (): void => {
    if (!turnId || !baseline || input.signal.aborted) return
    const measured = turnUsage.get(turnId)
    if (!measured?.total || measured.invalid || !nondecreasing(measured.total, baseline)) return
    const delta = usageDelta(measured.total, baseline), snapshot = JSON.stringify(delta)
    if (snapshot === lastUsageUpdate) return
    lastUsageUpdate = snapshot
    input.onUsageUpdate?.(delta)
  }
  let resolveTurn: (value: any) => void = () => {}, rejectTurn: (error: Error) => void = () => {}
  const completion = new Promise<any>((resolve, reject) => { resolveTurn = resolve; rejectTurn = reject }); completion.catch(() => {})
  const backgroundClose = (): void => { void Promise.resolve(transport.close()).catch(() => {}) }
  const onAbort = (): void => { if (threadId && turnId) void transport.request('turn/interrupt', { threadId, turnId }).catch(() => {}); rejectTurn(new Error('Native goal execution cancelled')); backgroundClose() }
  const timer = setTimeout(() => { rejectTurn(new Error('Native goal turn timeout')); backgroundClose() }, input.timeoutMs ?? 20 * 60_000)
  input.signal.addEventListener('abort', onAbort, { once: true })
  transport.onNotification((method, params) => {
    if (method === 'yoke/transportFailure') { rejectTurn(new Error('Codex native transport failed')); return }
    if (params?.threadId !== threadId) return
    if (method === 'thread/tokenUsage/updated') {
      if (turnId && params.turnId !== turnId) return
      if (typeof params.turnId !== 'string') return
      const total = parseUsage(params.tokenUsage?.total), prior = turnUsage.get(params.turnId)
      const decreased = Boolean(prior?.decreased || (total && baseline && !nondecreasing(total, baseline)) || (total && prior?.total && !nondecreasing(total, prior.total)))
      const invalid = Boolean(prior?.invalid || !total || decreased || input.binding?.usageInvalid)
      turnUsage.set(params.turnId, { total, invalid, decreased })
      if (turnUsage.size > 32) turnUsage.delete(turnUsage.keys().next().value!)
      publishUsageUpdate()
    }
    if (method === 'turn/completed' && typeof params.turn?.id === 'string') { completedTurns.set(params.turn.id, params.turn); if (turnId && params.turn.id === turnId) resolveTurn(params.turn); if (completedTurns.size > 32) completedTurns.delete(completedTurns.keys().next().value!) }
  })
  try {
    await initialize(transport)
    const started = await transport.request(input.binding ? 'thread/resume' : 'thread/start', { ...(threadId ? { threadId } : {}), cwd: input.root, model: input.selection.model, modelProvider: input.selection.provider, approvalPolicy: 'never', sandbox: 'workspace-write', config: { 'features.multi_agent': false } })
    if (typeof started?.thread?.id !== 'string' || (threadId && started.thread.id !== threadId)) throw new Error('Malformed native thread binding')
    threadId = started.thread.id
    const binding: NativeGoalBinding = { provider: 'codex', threadId: threadId!, objectiveRevision: objectiveRevision(input.objective), model: input.selection.model, modelProvider: input.selection.provider, ...(baseline ? { usageBaseline: baseline } : {}), ...(input.binding?.usageInvalid ? { usageInvalid: true } : {}) }
    let used = 0
    if (input.binding) { const goal = nativeGoal(await goalRequest(transport, 'thread/goal/get', { threadId }), input.objective); if (!Number.isSafeInteger(goal.tokensUsed) || goal.tokensUsed < 0) throw new Error('Malformed native goal usage'); used = goal.tokensUsed }
    const budget = input.tokenBudget === undefined ? null : used + input.tokenBudget
    if (budget !== null && !Number.isSafeInteger(budget)) throw new Error('Native goal token budget overflow')
    await goalRequest(transport, 'thread/goal/set', { threadId, objective: input.objective, tokenBudget: budget, status: 'paused' })
    await input.onBinding?.(binding)
    const turn = await transport.request('turn/start', { threadId, input: [{ type: 'text', text: input.prompt }], ...(input.selection.reasoningEffort ? { effort: input.selection.reasoningEffort } : {}) })
    if (typeof turn?.turn?.id !== 'string') throw new Error('Malformed native turn reply')
    turnId = turn.turn.id
    publishUsageUpdate()
    if (input.signal.aborted) throw new Error('Native goal execution cancelled')
    const result = completedTurns.get(turnId!) ?? await completion
    if (result?.id !== turnId || !['completed', 'failed', 'interrupted'].includes(result.status)) throw new Error('Malformed native turn completion')
    const observed = nativeGoal(await goalRequest(transport, 'thread/goal/get', { threadId }), input.objective)
    await goalRequest(transport, 'thread/goal/set', { threadId, status: 'paused' })
    const measured = turnUsage.get(turnId!)
    if (measured?.total && !measured.invalid && (!baseline || nondecreasing(measured.total, baseline))) {
      if (baseline) usage = usageDelta(measured.total, baseline)
      binding.usageBaseline = measured.total
      await input.onBinding?.(binding)
    }
    if (measured?.decreased) { binding.usageInvalid = true; await input.onBinding?.(binding) }
    if (usage) input.onUsage?.(usage)
    return { success: result.status === 'completed', summary: result.status === 'completed' ? 'Native Codex turn finished; requires independent Yoke check' : `Native Codex turn ${result.status}`, tokens: usage, ...usage, provider: 'codex', nativeBinding: binding, nativeStatus: 'paused', nativeObservedStatus: observed.status, ...(Number.isSafeInteger(observed.tokensUsed) && observed.tokensUsed >= 0 ? { nativeTokensUsed: observed.tokensUsed } : {}) }
  } finally { clearTimeout(timer); input.signal.removeEventListener('abort', onAbort); await transport.close() }
}
export async function synchronizeNativeGoal(input: { root: string; binding: NativeGoalBinding; objective: string; status: NativeGoalStatus; tokenBudget?: number; signal?: AbortSignal; bare?: boolean; transport?: NativeGoalTransport }): Promise<void> {
  if (input.bare) throw new Error('Native Codex goals do not support bare startup: app-server cannot ignore user config; use Codex exec for bare mode')
  validateBinding(input.binding, input.objective)
  if (input.signal?.aborted) throw new Error('Native goal synchronization cancelled')
  const transport = input.transport ?? createNativeGoalTransport(input.root, undefined, undefined, { bare: input.bare })
  const abort = (): void => { void Promise.resolve(transport.close()).catch(() => {}) }
  input.signal?.addEventListener('abort', abort, { once: true })
  try { await initialize(transport); await transport.request('thread/resume', { threadId: input.binding.threadId, cwd: input.root }); nativeGoal(await goalRequest(transport, 'thread/goal/get', { threadId: input.binding.threadId }), input.objective); await goalRequest(transport, 'thread/goal/set', { threadId: input.binding.threadId, status: input.status, ...(input.tokenBudget === undefined ? {} : { tokenBudget: input.tokenBudget }) }) }
  finally { input.signal?.removeEventListener('abort', abort); await transport.close() }
}
