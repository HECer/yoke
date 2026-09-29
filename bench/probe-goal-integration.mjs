// Read-only protocol capability probe plus disposable local goal resource test.
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createProjectGoal, runProjectGoal } from '../dist/goals/command.js'
import { acquireSharedWorker, sharedPoolStatus } from '../dist/loop/resource-pool.js'
const root = resolve(process.argv[2] ?? `G:/NN-Developed/Yoke-Testground/goal-probe-${Date.now()}`)
mkdirSync(join(root, '.yoke'), { recursive: true })
process.env.LOCALAPPDATA = join(root, 'isolated-state')
process.env.YOKE_MAX_PARALLEL_WORKERS = '1'
process.env.YOKE_STATE_DIR = join(root, 'yoke-state')
writeFileSync(join(root, '.yoke/acceptance.yaml'), 'version: 1\nprotected: [test.mjs]\ncriteria:\n- id: outcome\n  text: Expected outcome\n  commands: [node test.mjs]\n')
writeFileSync(join(root, 'test.mjs'), 'import {existsSync} from "node:fs"; process.exit(existsSync("implemented.txt") ? 0 : 1)')
createProjectGoal(root, 'Disposable test goal', { acceptanceIds: ['outcome'] })
const lease = await acquireSharedWorker({ targetDir: root, storyId: 'occupied', provider: 'codex', role: 'implementation' })
let executedWhilePoolFull = false, occupiedPermitHeld = true
let goal, queuedWhilePoolFull = false
try {
  const running = runProjectGoal(root, { execute: async () => {
    const pool = sharedPoolStatus(); executedWhilePoolFull = occupiedPermitHeld && pool.activeUnits === pool.limit
    writeFileSync(join(root, 'implemented.txt'), 'done')
    return { success: true, summary: 'Fake executor for mechanical pool test', inputTokens: 1, outputTokens: 1 }
  } })
  // Admission is asynchronous. Release the occupied provider permit only after
  // the goal has completed its independent check and queued for implementation.
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (sharedPoolStatus().waitingWorkers > 0) { queuedWhilePoolFull = true; break }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  occupiedPermitHeld = false
  await lease.release()
  goal = await running
} finally { await lease.release() }
const findings = { poolProbe: { fakeExecutor: true, limit: 1, queuedWhilePoolFull, executedWhilePoolFull, goalStatus: goal.status }, protocol: [] }
// A successful implementation that overshoots budget must remain blocked.
const budgetRoot = join(root, 'budget-probe'); mkdirSync(join(budgetRoot, '.yoke'), { recursive: true })
writeFileSync(join(budgetRoot, '.yoke/acceptance.yaml'), 'version: 1\nprotected: [test.mjs]\ncriteria:\n- id: outcome\n  text: Expected outcome\n  commands: [node test.mjs]\n')
writeFileSync(join(budgetRoot, 'test.mjs'), 'import {existsSync} from "node:fs"; await new Promise(r=>setTimeout(r,120)); process.exit(existsSync("implemented.txt") ? 0 : 1)')
createProjectGoal(budgetRoot, 'Disposable budget test', { acceptanceIds: ['outcome'], tokenBudget: 1, maxMinutes: 0.001 })
const budgetStart = Date.now()
const budgetGoal = await runProjectGoal(budgetRoot, { execute: async () => {
  writeFileSync(join(budgetRoot, 'implemented.txt'), 'done')
  return { success: true, summary: 'Fake executor reporting 100 tokens', inputTokens: 90, outputTokens: 10 }
} })
findings.budgetProbe = { fakeExecutor: true, tokenBudget: 1, measuredTokens: 100, timeBudgetMs: 60, totalWallMs: Date.now() - budgetStart, recordedAgentMs: budgetGoal.attempts[0]?.durationMs, status: budgetGoal.status }
const objectiveRoot = join(root, 'objective-probe'); mkdirSync(join(objectiveRoot, '.yoke'), { recursive: true })
writeFileSync(join(objectiveRoot, '.yoke/acceptance.yaml'), 'version: 1\nprotected: [test.mjs]\ncriteria:\n- id: old-feature\n  text: Existing feature still works\n  commands: [node test.mjs]\n')
writeFileSync(join(objectiveRoot, 'test.mjs'), 'import {existsSync} from "node:fs"; process.exit(existsSync("old-feature.txt") ? 0 : 1)')
writeFileSync(join(objectiveRoot, 'old-feature.txt'), 'already implemented')
createProjectGoal(objectiveRoot, 'Implement the new feature by creating new-feature.txt')
let objectiveExecutorCalled = false
const objectiveGoal = await runProjectGoal(objectiveRoot, { execute: async () => { objectiveExecutorCalled = true; return { success: false, summary: 'Should need implementation' } } })
findings.objectiveProbe = { requestedArtifact: 'new-feature.txt', requestedArtifactExists: existsSync(join(objectiveRoot, 'new-feature.txt')), acceptance: 'only checks old-feature.txt; intentionally unbound objective', executorCalled: objectiveExecutorCalled, attempts: objectiveGoal.attempts.length, status: objectiveGoal.status }
const cli = join(process.env.APPDATA, 'npm/node_modules/@openai/codex/bin/codex.js')
const child = spawn(process.execPath, [cli, 'app-server', '--stdio', '--enable', 'goals'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] })
let next = 1, buffer = '', errorText = ''; const pending = new Map()
child.stderr.on('data', d => { errorText += d })
child.stdout.on('data', data => {
  buffer += data
  while (buffer.includes('\n')) {
    const i = buffer.indexOf('\n'), line = buffer.slice(0, i); buffer = buffer.slice(i + 1)
    try { const message = JSON.parse(line); if (pending.has(message.id)) { const p = pending.get(message.id); pending.delete(message.id); message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result) } } catch {}
  }
})
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = next++; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)) }, 30_000)
    pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result) }, reject: error => { clearTimeout(timer); reject(error) } })
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
  })
}
try {
  await rpc('initialize', { clientInfo: { name: 'yoke-goals-probe', version: '1.0.0' }, capabilities: { experimentalApi: true } })
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n')
  const start = await rpc('thread/start', { cwd: root, model: 'gpt-6.1-sol', approvalPolicy: 'never', sandbox: 'read-only' })
  const threadId = start.thread.id
  for (const [method, params] of [
    ['thread/goal/set', { threadId, objective: 'Protocol-only goal: no development turn requested', tokenBudget: 1000 }],
    ['thread/goal/get', { threadId }],
    ['thread/goal/set', { threadId, status: 'paused' }],
    ['thread/goal/get', { threadId }],
    ['thread/goal/clear', { threadId }],
    ['thread/goal/get', { threadId }],
  ]) {
    const result = await rpc(method, params); findings.protocol.push({ method, requestedStatus: params.status ?? null, result })
  }
  await rpc('thread/archive', { threadId })
} catch (error) { findings.protocolError = error.message; findings.stderrTail = errorText.slice(-2000) }
finally { child.stdin.end(); child.kill() }
writeFileSync(join(root, 'findings.json'), JSON.stringify(findings, null, 2))
console.log(JSON.stringify(findings, null, 2))
if (findings.protocolError) process.exitCode = 1
