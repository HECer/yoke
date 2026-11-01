import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { beginBudgetCall, budgetedInvocation, executionBudgetPath, executionBudgetStatus, finishBudgetCall, resetExecutionBudget, updateExecutionBudgetUsage, withExecutionBudget, withExecutionBudgetScope } from '../../src/execution/budget.js'
import { saveConfig, type ExecutionBudgetSettings } from '../../src/retrofit/config.js'
import { observedError } from '../../src/observability/failure.js'
import { measureInvocation } from '../../src/observability/invocation.js'
import { providerTelemetryUsage } from '../../src/observability/usage.js'
import { makeReviewRunner, makeRunner, runCapturedAgent, type Invocation } from '../../src/loop/runner.js'
import { startProviderProcess } from '../../src/agents/providers.js'

let temporary: string, root: string
beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), 'yoke-execution-budget-'))
  root = join(temporary, 'project'); mkdirSync(root)
  vi.stubEnv('LOCALAPPDATA', join(temporary, 'state'))
  vi.stubEnv('YOKE_STATE_DIR', join(temporary, 'runtime'))
  configure({ id: 'work package / 1', maxCalls: 24 })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(temporary, { recursive: true, force: true }) })
function configure(executionBudget?: ExecutionBudgetSettings): void { saveConfig(root, { canonVersion: 'test', agents: ['codex'], loop: { enabled: true }, executionBudget }) }
function call(role = 'implementation', prompt = 'Complete the approved task') { return { root, provider: 'codex', role, storyId: 'S1', prompt } }
function status() {
  const value = executionBudgetStatus(root)
  if (!value.configured) throw Error('expected configured budget')
  return value
}
const usage = { inputTokens: 8, outputTokens: 2, measurementComplete: true }
function invocation(cwd = root, code = 0, output = '{"usage":{"input_tokens":8,"output_tokens":2},"model":"fixture"}\n'): Invocation {
  return { command: process.execPath, args: ['--eval', `process.stdout.write(${JSON.stringify(output)}); process.exit(${code})`], input: 'approved input', cwd, execution: { root, role: 'implementation', provider: 'codex', storyId: 'S1' } }
}

it('leaves existing projects uncapped and does not create a ledger without opt-in', () => {
  configure()
  expect(withExecutionBudget(call(), () => 'ok')).toBe('ok')
  expect(executionBudgetStatus(root)).toMatchObject({ configured: false })
  expect(existsSync(join(temporary, 'state', 'Yoke', 'execution-budgets'))).toBe(false)
})

it('keeps one durable allowance across invocations and planning changes', () => {
  configure({ id: 'work package / 1', maxCalls: 1 })
  withExecutionBudget(call('prd-draft'), () => ({ success: true, tokens: usage }))
  const first = status()
  writeFileSync(join(root, '.yoke', 'prd.yaml'), 'different plan')
  writeFileSync(join(root, '.yoke', 'plan.md'), 'different approved brief')
  const dispatched = vi.fn()
  expect(() => withExecutionBudget(call('repair'), dispatched)).toThrow(/call limit 1 exhausted/)
  expect(dispatched).not.toHaveBeenCalled()
  expect(status()).toMatchObject({ epoch: first.epoch, admittedCalls: 1, knownTokens: 10, unknownTokenCalls: 0, unknownCostCalls: 1 })
  expect(status().calls[0]).toMatchObject({ role: 'prd-draft', storyId: 'S1', promptBytes: Buffer.byteLength(call().prompt) })
  expect(readFileSync(executionBudgetPath(root, first.id), 'utf8')).not.toContain(call().prompt)
})

it.each(['remove', 'new identity', 'raise limit'])('freezes host budget policy when a worker tries to %s configuration mid-command', async edit => {
  configure({ id: 'work package / 1', maxCalls: 1 })
  await withExecutionBudgetScope(root, async () => {
    await withExecutionBudget(call(), async () => {
      if (edit === 'remove') rmSync(join(root, '.yoke', 'config.yaml'))
      else configure({ id: edit === 'new identity' ? 'new allowance' : 'work package / 1', maxCalls: 100 })
      return { success: true, tokens: usage }
    })
    const review = vi.fn()
    expect(() => withExecutionBudget(call('review'), review)).toThrow(/call limit 1 exhausted/)
    expect(review).not.toHaveBeenCalled()
    expect(status()).toMatchObject({ id: 'work package / 1', admittedCalls: 1 })
  })
})

it('rejects oversized mandatory input by UTF-8 byte count before reserving or dispatching', () => {
  configure({ id: 'work package / 1', maxPromptBytes: 3 })
  const dispatched = vi.fn()
  expect(() => withExecutionBudget(call('prd-draft', '😀'), dispatched)).toThrow(/4 bytes.*nothing was truncated/)
  expect(dispatched).not.toHaveBeenCalled()
  expect(status().admittedCalls).toBe(0)
})

it('preserves failed partial usage and blocks a token-limited continuation instead of charging zero', () => {
  configure({ id: 'work package / 1', maxTokens: 100 })
  const error = Object.assign(Error('provider interrupted'), { stdout: '{"usage":{"input_tokens":17}}\n' })
  expect(() => withExecutionBudget(call(), () => { throw error })).toThrow(error)
  expect(status()).toMatchObject({ admittedCalls: 1, knownTokens: 17, unknownTokenCalls: 1, unknownCostCalls: 1 })
  expect(status().calls[0].usage).toEqual({ inputTokens: 17, complete: false, costComplete: false })
  expect(() => withExecutionBudget(call('review'), () => 'must not run')).toThrow(/unknown usage is not free/)
})

it.each([undefined, { cachedInputTokens: 4 }, { cachedInputTokens: 4, cacheWriteInputTokens: 3, usagePartialFields: ['cacheWriteInputTokens'] }])('keeps Claude totals incomplete when separate cache counters are absent or partial: %j', cache => {
  configure({ id: 'work package / 1', maxTokens: 100 })
  withExecutionBudget({ ...call(), provider: 'claude' }, () => ({ tokens: { ...usage, ...cache } }))
  expect(status().unknownTokenCalls).toBe(1)
  expect(() => withExecutionBudget(call('review'), () => 'blocked')).toThrow(/unknown usage is not free/)
})

it('adds complete Claude cache counters once and accepts explicit zero counters', () => {
  configure({ id: 'work package / 1', maxTokens: 100 })
  withExecutionBudget({ ...call(), provider: 'claude' }, () => ({ tokens: { ...usage, cachedInputTokens: 4, cacheWriteInputTokens: 3 } }))
  withExecutionBudget({ ...call(), provider: 'claude' }, () => ({ tokens: { ...usage, cachedInputTokens: 0, cacheWriteInputTokens: 0 } }))
  expect(status()).toMatchObject({ admittedCalls: 2, knownTokens: 27, unknownTokenCalls: 0 })
})

it('checkpoints native cumulative usage and retains it when the native transport later fails', async () => {
  configure({ id: 'work package / 1', maxTokens: 100 })
  await expect(withExecutionBudget(call('goal-implementation'), async () => {
    updateExecutionBudgetUsage({ inputTokens: 10, outputTokens: 3 })
    updateExecutionBudgetUsage({ inputTokens: 17, outputTokens: 9 })
    throw Error('native disconnected')
  })).rejects.toThrow('native disconnected')
  expect(status()).toMatchObject({ admittedCalls: 1, knownTokens: 26, unknownTokenCalls: 1 })
  expect(status().calls[0]).toMatchObject({ role: 'goal-implementation', outcome: 'failed', usage: { inputTokens: 17, outputTokens: 9, complete: false } })
})

it('does not promote a lower final counter over an earlier native checkpoint', () => {
  withExecutionBudget(call(), () => { updateExecutionBudgetUsage({ inputTokens: 100, outputTokens: 3 }); return { success: true, tokens: usage } })
  expect(status()).toMatchObject({ knownTokens: 103, unknownTokenCalls: 1 })
})

it('records proven preflight failures as zero while retaining their admitted attempt', () => {
  configure({ id: 'work package / 1', maxTokens: 10 })
  expect(() => withExecutionBudget(call(), () => { throw observedError('launcher unavailable', 'preflight', 'not-started') })).toThrow('launcher unavailable')
  expect(status()).toMatchObject({ admittedCalls: 1, knownTokens: 0, unknownTokenCalls: 0, knownCostUsd: 0, unknownCostCalls: 0 })
  withExecutionBudget(call(), () => ({ success: true, tokens: usage }))
  expect(() => withExecutionBudget(call(), () => 'blocked')).toThrow(/token limit exhausted/)
})

it('preserves the original error when failed telemetry cannot be read', () => {
  const error = Object.defineProperty(Error('original provider failure'), 'stdout', { get: () => { throw Error('invalid stream getter') } })
  expect(() => withExecutionBudget(call(), () => { throw error })).toThrow(error)
  expect(status()).toMatchObject({ admittedCalls: 1, unknownTokenCalls: 1, completedCalls: 1 })
})

it('admits concurrent in-flight work honestly and blocks later calls after a measured overrun', async () => {
  configure({ id: 'work package / 1', maxTokens: 10 })
  let finishFirst!: (value: { tokens: typeof usage }) => void, finishSecond!: (value: { tokens: typeof usage }) => void
  const first = withExecutionBudget(call(), () => new Promise<{ tokens: typeof usage }>(resolve => { finishFirst = resolve }))
  const second = withExecutionBudget(call('review'), () => new Promise<{ tokens: typeof usage }>(resolve => { finishSecond = resolve }))
  expect(status()).toMatchObject({ admittedCalls: 2, pendingCalls: 2 })
  expect(status().summary).toContain('already admitted calls can overshoot')
  finishFirst({ tokens: usage }); finishSecond({ tokens: usage }); await Promise.all([first, second])
  expect(status()).toMatchObject({ knownTokens: 20, pendingCalls: 0 })
  expect(() => withExecutionBudget(call(), () => 'blocked')).toThrow(/token limit exhausted/)
})

it('uses aggregate admitted agent time including live reservations', () => {
  configure({ id: 'work package / 1', maxMinutes: 1 })
  let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now)
  const first = beginBudgetCall(call())!, second = beginBudgetCall(call('review'))!
  now += 30_001
  expect(status().durationMs).toBe(60_002)
  expect(() => beginBudgetCall(call())).toThrow(/agent-time limit exhausted/)
  finishBudgetCall(first, { success: true, tokens: usage }); finishBudgetCall(second, { success: true, tokens: usage })
})

it('does not reset live admissions and archives completed evidence on an explicit reset', () => {
  const ticket = beginBudgetCall(call())!
  expect(() => resetExecutionBudget(root)).toThrow(/still be running/)
  finishBudgetCall(ticket, { success: true, tokens: usage })
  const before = status()
  const reset = resetExecutionBudget(root)
  expect(reset).toMatchObject({ configured: true, admittedCalls: 0 })
  expect(reset.configured && reset.epoch).not.toBe(before.epoch)
  const archive = join(dirname(executionBudgetPath(root, before.id)), `epoch-${before.epoch}.json`)
  expect(JSON.parse(readFileSync(archive, 'utf8')).calls).toHaveLength(1)
})

it('rejects corrupt or symlinked budget state without dispatching', () => {
  const file = executionBudgetPath(root, 'work package / 1'), dispatched = vi.fn()
  writeFileSync(file, '{broken')
  expect(() => withExecutionBudget(call(), dispatched)).toThrow()
  expect(dispatched).not.toHaveBeenCalled()
  rmSync(file)
  if (process.platform === 'win32') {
    // Junctions exercise linked-ancestor rejection without requiring symlink privileges.
    const outside = join(temporary, 'linked-budget')
    renameSync(dirname(file), outside)
    symlinkSync(outside, dirname(file), 'junction')
  } else symlinkSync(join(temporary, 'absent-state'), file)
  expect(() => withExecutionBudget(call(), dispatched)).toThrow(/host state|execution budget storage/i)
  expect(dispatched).not.toHaveBeenCalled()
})

it('charges a temporary critic or worker to the host project and deduplicates nested capture wrappers', () => {
  configure({ id: 'work package / 1', maxCalls: 1 })
  const worker = join(temporary, 'temporary-critic'); mkdirSync(worker)
  const inv = invocation(worker)
  const result = measureInvocation({ root, agent: 'codex', role: 'quality-critic', storyId: 'S1', invocation: inv, execute: admitted => runCapturedAgent('codex', admitted) })
  expect(result.success).toBe(true)
  expect(status()).toMatchObject({ admittedCalls: 1, knownTokens: 10 })
  expect(status().calls[0].role).toBe('quality-critic')
  expect(executionBudgetStatus(worker)).toMatchObject({ configured: false })
  expect(runCapturedAgent('codex', inv)).toMatchObject({ success: false, failure: { modelExecution: 'not-started' } })
  expect(status().admittedCalls).toBe(1)
})

it('accounts actual asynchronous provider exits, including failed usage, and rejects before another spawn', async () => {
  configure({ id: 'work package / 1', maxCalls: 2 })
  const first = await startProviderProcess('codex', invocation()).completion
  const failed = await startProviderProcess('codex', { ...invocation(root, 7), execution: { root, role: 'routing' } }).completion
  expect(first.kind).toBe('succeeded'); expect(failed.kind).toBe('failed')
  expect(status()).toMatchObject({ admittedCalls: 2, knownTokens: 20, completedCalls: 2 })
  expect(status().calls.map(item => [item.role, item.outcome])).toEqual([['implementation', 'succeeded'], ['routing', 'failed']])
  const denied = startProviderProcess('codex', invocation())
  expect(denied.pid).toBeUndefined()
  expect(await denied.completion).toMatchObject({ kind: 'spawn-failed', failure: { modelExecution: 'not-started' } })
})

it('reuses the outer native admission around an asynchronous process fallback', async () => {
  configure({ id: 'work package / 1', maxCalls: 1 })
  const result = await budgetedInvocation('codex', { ...invocation(), execution: { root, role: 'goal-implementation' } }, async admitted => {
    const process = await startProviderProcess('codex', admitted).completion
    return { success: process.kind === 'succeeded', tokens: providerTelemetryUsage(process.telemetry, 'codex') }
  })
  expect(result.success).toBe(true)
  expect(status()).toMatchObject({ admittedCalls: 1, knownTokens: 10, pendingCalls: 0 })
  expect(status().calls[0].role).toBe('goal-implementation')
})

it('does not reuse an active ticket for a different nested provider or prompt', () => {
  configure({ id: 'work package / 1', maxCalls: 1 })
  const second = vi.fn(() => ({ tokens: { inputTokens: 70, outputTokens: 30 } }))
  expect(() => withExecutionBudget(call(), () => withExecutionBudget({ ...call('review', 'different prompt'), provider: 'claude' }, second))).toThrow(/call limit 1/)
  expect(second).not.toHaveBeenCalled()
  expect(status().admittedCalls).toBe(1)
})

it.each([1, 2])('charges identical sibling actual dispatches separately with allowance %d', async maxCalls => {
  configure({ id: 'work package / 1', maxCalls })
  const inv = invocation()
  await withExecutionBudget({ ...call(), prompt: inv.input }, async () => {
    const first = startProviderProcess('codex', inv), second = startProviderProcess('codex', inv)
    const results = await Promise.all([first.completion, second.completion])
    expect(results[0].kind).toBe('succeeded')
    expect(results[1].kind).toBe(maxCalls === 1 ? 'spawn-failed' : 'succeeded')
    if (maxCalls === 1) expect(second.pid).toBeUndefined()
    // Wrapper results must not replace the individual dispatch measurements.
    return { tokens: { inputTokens: 999, outputTokens: 999 } }
  })
  expect(status()).toMatchObject({ admittedCalls: maxCalls, completedCalls: maxCalls, knownTokens: maxCalls * 10 })
})

it('covers implementation and review factories even with injected execution adapters', () => {
  const story = { id: 'S1', title: 'Fixture', priority: 1, passes: false, acceptance: ['works'] }
  makeRunner('codex', 0, { ownershipRoot: root, execCapture: () => '{"usage":{"input_tokens":8,"output_tokens":2}}\n' })({ targetDir: root, story })
  makeReviewRunner('codex', 0, () => ({ success: false, output: '', summary: 'fixture rejects', tokens: usage }), {}, root)({ targetDir: root, story })
  expect(status()).toMatchObject({ admittedCalls: 2, knownTokens: 20 })
  expect(status().calls.map(item => item.role)).toEqual(['implementation', 'review'])
})

it('reserves durably before dispatch and retains the charge when a controller exits', () => {
  configure({ id: 'work package / 1', maxCalls: 1, maxMinutes: 120, maxTokens: 100 })
  const module = pathToFileURL(join(process.cwd(), 'src/execution/budget.ts')).href
  const script = `import {withExecutionBudget} from ${JSON.stringify(module)}; withExecutionBudget(${JSON.stringify(call())},()=>process.exit(73));`
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: process.cwd(), env: process.env, encoding: 'utf8' })
  expect(child.status, child.stderr).toBe(73)
  expect(status()).toMatchObject({ admittedCalls: 1, pendingCalls: 1, unresolvedCalls: 1, unknownTokenCalls: 1, durationComplete: false })
  expect(() => withExecutionBudget(call(), () => 'blocked')).toThrow(/call limit/)
  expect(resetExecutionBudget(root)).toMatchObject({ admittedCalls: 0 })
})

it('serializes simultaneous cross-process reservations without exceeding the call allowance', async () => {
  configure({ id: 'work package / 1', maxCalls: 3 })
  const module = pathToFileURL(join(process.cwd(), 'src/execution/budget.ts')).href
  const script = `import {appendFileSync} from 'node:fs'; import {withExecutionBudget} from ${JSON.stringify(module)}; try {withExecutionBudget(${JSON.stringify(call())},()=>{appendFileSync(${JSON.stringify(join(root, 'dispatches'))},'started\\n'); return {tokens:{inputTokens:1,outputTokens:1}}})} catch(error) {if(!error.message.includes('call limit')) throw error; process.exitCode=23}`
  const results = await Promise.all(Array.from({ length: 7 }, () => new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''; child.stderr.on('data', value => { stderr += value }); child.on('error', reject); child.on('close', code => resolve({ code, stderr }))
  })))
  expect(results.filter(item => item.code === 0)).toHaveLength(3)
  expect(results.filter(item => item.code === 23)).toHaveLength(4)
  expect(results.map(item => item.stderr).join('')).toBe('')
  expect(readFileSync(join(root, 'dispatches'), 'utf8').trim().split('\n')).toHaveLength(3)
  expect(status()).toMatchObject({ admittedCalls: 3, completedCalls: 3, knownTokens: 6 })
  expect(readdirSync(dirname(executionBudgetPath(root, 'work package / 1')))).toEqual(['state.json'])
}, 20_000)
