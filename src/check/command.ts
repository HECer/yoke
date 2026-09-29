import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import { defaultConfig, loadConfig, resolveVerifyCommand } from '../retrofit/config.js'
import { commandVerifier, type VerifyResult } from '../loop/verify.js'
import { workspaceFingerprint } from '../workspace/fingerprint.js'
import { statePath } from '../workspace/state.js'
import { spawn } from 'node:child_process'
import { acquireSharedWorker } from '../loop/resource-pool.js'
import { compactCommandOutput } from '../output/compact.js'
import { writeOutputArtifact } from '../output/artifact.js'
import { DEFAULT_OUTPUT_POLICY } from '../output/types.js'
import { createProviderProcessRecord, filesystemProviderProcessRecordAdapter } from '../agents/process-record.js'
import { trackProcessRecordIdentity } from '../agents/process-record-identity.js'

const Criterion = z.object({ id: z.string().min(1).max(120), text: z.string().min(1).max(8000), commands: z.array(z.string().min(1).max(8000)).max(30) }).strict()
const Acceptance = z.object({ version: z.literal(1), criteria: z.array(Criterion).max(200), protected: z.array(z.string().min(1)).max(500).default([]) }).strict().superRefine((value, ctx) => {
  if (new Set(value.criteria.map(c => c.id)).size !== value.criteria.length) ctx.addIssue({ code: 'custom', message: 'Duplicate acceptance criterion id' })
})
export type AcceptanceManifest = z.infer<typeof Acceptance>
export type CheckStatus = 'passed' | 'failed' | 'unverified'
export interface CheckCriterion { id: string; text: string; commands: string[]; status: CheckStatus; summary: string }
export interface CheckReport {
  version: 1; id: string; generatedAt: string; fingerprint: string; status: CheckStatus
  summary: string; criteria: CheckCriterion[]; durationMs: number; evidencePath: string
  cleanupUnconfirmed?: true
}
interface AsyncVerifyResult extends VerifyResult { cleanupUnconfirmed?: true; cleanupConfirmed?: Promise<void> }
export interface CheckOptions {
  requirement?: string
  execute?: (command: string, root: string) => VerifyResult
}
export interface AsyncCheckOptions {
  requirement?: string
  execute?: (command: string, root: string, signal?: AbortSignal) => Promise<VerifyResult> | VerifyResult
  signal?: AbortSignal
  /** Absolute epoch milliseconds, including admission wait and command execution. */
  deadline?: number
}
export async function checkProjectAsync(directory: string, options: AsyncCheckOptions = {}): Promise<CheckReport> {
  const controller = new AbortController()
  const abort = (): void => controller.abort(options.signal?.reason ?? 'Verification cancelled')
  if (options.signal?.aborted) abort()
  else options.signal?.addEventListener('abort', abort, { once: true })
  const remaining = options.deadline === undefined ? undefined : options.deadline - Date.now()
  if (remaining !== undefined && remaining <= 0) controller.abort('Verification deadline reached')
  const timer = remaining === undefined || remaining <= 0 ? undefined : setTimeout(() => controller.abort('Verification deadline reached'), remaining)
  let lease: Awaited<ReturnType<typeof acquireSharedWorker>> | undefined
  let report: CheckReport | undefined
  let cleanupUnconfirmed = false
  try {
    try { lease = await acquireSharedWorker({ targetDir: directory, storyId: 'project-check', provider: 'codex', role: 'integration', resource: 'check', signal: controller.signal }) }
    catch (error) {
      if (!controller.signal.aborted) throw error
      // Persist failed evidence even when cancellation happens while queued.
    }
    if (options.deadline !== undefined && Date.now() >= options.deadline) controller.abort('Verification deadline reached')
    report = await checkProjectAsyncAdmitted(directory, { ...options, signal: controller.signal, onCleanupUnconfirmed: confirmed => { cleanupUnconfirmed = true; if (confirmed) void confirmed.then(() => lease?.release()).catch(() => {}) } })
    return report
  } finally { if (timer) clearTimeout(timer); options.signal?.removeEventListener('abort', abort); if (!cleanupUnconfirmed) await lease?.release() }
}
function verifyCommandAsync(command: string, root: string, signal?: AbortSignal): Promise<AsyncVerifyResult> {
  if (signal?.aborted) return Promise.resolve({ passed: false, summary: 'Verification cancelled or deadline reached' })
  return new Promise(resolveResult => {
    const child = spawn(command, { cwd: root, shell: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const record = child.pid ? createProviderProcessRecord(realpathSync(root), child.pid, 'verification', `unverified:${new Date().toISOString()}`) : undefined
    let publishFailed = false
    if (record) { try { filesystemProviderProcessRecordAdapter.publish(record) } catch { publishFailed = true } }
    const cancelIdentity = trackProcessRecordIdentity(record, child)
    let stdout = '', stderr = '', captured = 0, stopped = '', settled = false, exited = false, treeStopped = process.platform !== 'win32'
    let resolveConfirmed = (): void => {}
    const cleanupConfirmed = new Promise<void>(resolveValue => { resolveConfirmed = resolveValue })
    const confirm = (): void => { if (exited && (!stopped || treeStopped)) { cancelIdentity(); if (record) filesystemProviderProcessRecordAdapter.remove(record.path); resolveConfirmed() } }
    const finish = (passed: boolean, reason = '', cleanupUnconfirmed = false): void => {
      if (settled) return; settled = true; clearTimeout(timer); if (cleanupTimer) clearTimeout(cleanupTimer); signal?.removeEventListener('abort', abort)
      cancelIdentity()
      if (record && exited && !cleanupUnconfirmed) filesystemProviderProcessRecordAdapter.remove(record.path)
      if (passed) { resolveResult({ passed: true, summary: `verify passed: ${command}` }); return }
      const raw = `=== stdout ===\n${stdout}\n=== stderr ===\n${stderr}`
      const compacted = compactCommandOutput(raw, { previewBytes: DEFAULT_OUTPUT_POLICY.previewBytes })
      const parts = [`verify failed: ${command}${reason ? ` (${reason})` : ''}`, compacted.preview]
      if (compacted.originalBytes > DEFAULT_OUTPUT_POLICY.artifactThresholdBytes) { try { parts.push(writeOutputArtifact(root, raw, { phase: 'verify', storyId: process.env.YOKE_STORY }).marker) } catch { parts.push('[artifact unavailable]') } }
      resolveResult({ passed: false, summary: parts.filter(Boolean).join('\n'), ...(cleanupUnconfirmed ? { cleanupUnconfirmed: true, cleanupConfirmed } : {}) })
    }
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined
    const stop = (reason: string): void => {
      if (stopped || settled) return; stopped = reason
      if (child.pid) {
        if (process.platform === 'win32') { const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); killer.on('error', () => {}); killer.on('close', code => { treeStopped = code === 0; confirm(); if (exited && treeStopped) finish(false, stopped) }); killer.unref() }
        else { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }
      }
      if (process.platform !== 'win32') child.kill('SIGKILL')
      cleanupTimer = setTimeout(() => { if (process.platform !== 'win32') child.kill('SIGKILL'); finish(false, `${stopped}; process cleanup could not be confirmed`, !exited || !treeStopped) }, 4000)
    }
    const abort = (): void => stop('cancelled or deadline reached')
    const timer = setTimeout(() => stop('timed out'), 600_000)
    const append = (stream: 'stdout' | 'stderr', data: Buffer): void => {
      const room = Math.max(0, 16 * 1024 * 1024 - captured); captured += data.length
      if (stream === 'stdout') stdout += data.subarray(0, room).toString('utf8'); else stderr += data.subarray(0, room).toString('utf8')
      if (captured > 16 * 1024 * 1024) stop('capture limit exceeded')
    }
    child.stdout.on('data', data => append('stdout', data)); child.stderr.on('data', data => append('stderr', data))
    child.on('error', () => finish(false, 'command could not start')); child.on('close', code => { exited = true; confirm(); if (!stopped || treeStopped) finish(!stopped && code === 0, stopped) })
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort()
    if (publishFailed) stop('process ownership record could not be published')
  })
}
export function loadAcceptance(root: string): AcceptanceManifest | null {
  const file = statePath(root, 'acceptance.yaml')
  return existsSync(file) ? Acceptance.parse(parse(readFileSync(file, 'utf8'))) : null
}
function protectedPath(root: string, path: string): string {
  if (isAbsolute(path)) throw new Error('Protected path must be relative')
  const full = realpathSync(resolve(root, path))
  const rel = relative(realpathSync(root), full)
  if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Protected path escapes project')
  return full
}
function baselinePath(root: string): string {
  const id = createHash('sha256').update(realpathSync(root)).digest('hex')
  return join(process.env.YOKE_STATE_DIR ?? join(homedir(), '.yoke', 'state'), 'acceptance', `${id}.json`)
}
function protectedHashes(root: string, paths: string[]): Record<string, string> {
  return Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(protectedPath(root, path))).digest('hex')]))
}
/** Explicitly pin acceptance outside the worker workspace. Never refreshed by check. */
export function protectAcceptance(root: string, refresh = false): string {
  const manifest = loadAcceptance(root)
  if (!manifest) throw new Error('Create .yoke/acceptance.yaml before protecting acceptance')
  const paths = [...new Set(['.yoke/acceptance.yaml', ...manifest.protected, ...['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].filter(p => existsSync(join(root, p)))])]
  const file = baselinePath(root)
  const hashes = protectedHashes(root, paths)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ version: 1, hashes }), { flag: refresh ? 'w' : 'wx', mode: 0o600 })
  return file
}
export function acceptanceProtectionProblem(root: string, baselineRoot = root): string | null {
  const file = baselinePath(baselineRoot)
  if (!existsSync(file)) return null
  try {
    const baseline = z.object({ version: z.literal(1), hashes: z.record(z.string().regex(/^[a-f0-9]{64}$/)) }).strict().parse(JSON.parse(readFileSync(file, 'utf8')))
    if (!Object.keys(baseline.hashes).includes('.yoke/acceptance.yaml')) return 'Invalid protected acceptance baseline'
    const actual = protectedHashes(root, Object.keys(baseline.hashes))
    const changed = Object.keys(actual).filter(path => actual[path] !== baseline.hashes[path])
    return changed.length ? `Protected acceptance changed: ${changed.join(', ')}` : null
  } catch (error) { return `Protected acceptance cannot be verified: ${(error as Error).message}` }
}
export function checkProject(directory: string, options: CheckOptions = {}): CheckReport {
  const root = realpathSync(directory)
  const started = Date.now()
  const before = workspaceFingerprint(root)
  const problem = acceptanceProtectionProblem(root)
  const criteria: CheckCriterion[] = []
  const execute = options.execute ?? ((command, cwd) => commandVerifier(command, { phase: 'verify' })(cwd))
  if (problem) criteria.push({ id: 'protected-acceptance', text: 'Acceptance infrastructure unchanged', commands: [], status: 'failed', summary: problem })
  else {
    const manifest = loadAcceptance(root)
    for (const criterion of manifest?.criteria ?? []) {
      const results = criterion.commands.map(command => {
        try { return execute(command, root) } catch (error) { return { passed: false, summary: (error as Error).message } }
      })
      criteria.push({ ...criterion, status: results.length === 0 ? 'unverified' : results.every(r => r.passed) ? 'passed' : 'failed', summary: results.map(r => r.summary).join('\n') || 'No executable acceptance mapped' })
    }
    const command = resolveVerifyCommand(root, loadConfig(root) ?? defaultConfig('1.6.2'))
    if (command) {
      let result: VerifyResult
      try { result = execute(command, root) } catch (error) { result = { passed: false, summary: (error as Error).message } }
      criteria.push({ id: 'project-suite', text: 'Configured project verification', commands: [command], status: result.passed ? 'passed' : 'failed', summary: result.summary })
    }
    if (options.requirement) criteria.push({ id: 'requested-outcome', text: options.requirement, commands: [], status: 'unverified', summary: 'Map this outcome to executable criteria in .yoke/acceptance.yaml; a green suite alone is not proof of this requirement.' })
    if (criteria.length === 0) criteria.push({ id: 'acceptance', text: 'Project acceptance', commands: [], status: 'unverified', summary: 'No acceptance manifest or project verification command found' })
  }
  const changed = workspaceFingerprint(root) !== before
  const afterProblem = acceptanceProtectionProblem(root)
  if (changed || afterProblem) criteria.push({ id: 'source-integrity', text: 'Checked source remained stable', commands: [], status: 'failed', summary: afterProblem ?? 'Source changed during verification; run check again on a stable tree' })
  const status: CheckStatus = criteria.some(c => c.status === 'failed') ? 'failed' : criteria.some(c => c.status === 'unverified') ? 'unverified' : 'passed'
  const id = randomUUID()
  const evidencePath = statePath(root, 'checks', `${id}.json`)
  const report: CheckReport = { version: 1, id, generatedAt: new Date().toISOString(), fingerprint: before, status, summary: changed ? 'Source changed during verification' : `${criteria.filter(c => c.status === 'passed').length}/${criteria.length} checks passed; ${status}`, criteria, durationMs: Date.now() - started, evidencePath }
  mkdirSync(dirname(evidencePath), { recursive: true })
  writeFileSync(evidencePath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return report
}
export function checkExitCode(report: CheckReport): number { return report.status === 'passed' ? 0 : report.status === 'failed' ? 1 : 2 }

async function checkProjectAsyncAdmitted(directory: string, options: AsyncCheckOptions & { onCleanupUnconfirmed?: (confirmed?: Promise<void>) => void }): Promise<CheckReport> {
  const root = realpathSync(directory)
  const started = Date.now()
  const before = workspaceFingerprint(root)
  const problem = acceptanceProtectionProblem(root)
  const criteria: CheckCriterion[] = []
  let cleanupUnconfirmed = false
  const rawExecute = options.execute ?? ((command: string, cwd: string) => verifyCommandAsync(command, cwd, options.signal))
  const execute = async (command: string, cwd: string, signal?: AbortSignal): Promise<AsyncVerifyResult> => {
    if (cleanupUnconfirmed) return { passed: false, summary: 'Previous verification cleanup unconfirmed; no further commands admitted', cleanupUnconfirmed: true }
    const result: AsyncVerifyResult = await rawExecute(command, cwd, signal)
    if (result.cleanupUnconfirmed) { cleanupUnconfirmed = true; options.onCleanupUnconfirmed?.(result.cleanupConfirmed) }
    return result
  }
  if (problem) criteria.push({ id: 'protected-acceptance', text: 'Acceptance infrastructure unchanged', commands: [], status: 'failed', summary: problem })
  else {
    const manifest = loadAcceptance(root)
    for (const criterion of manifest?.criteria ?? []) {
      const results: VerifyResult[] = []
      for (const command of criterion.commands) {
        results.push(await (async () => {
        try { if (options.signal?.aborted) throw new Error('Verification cancelled or deadline reached'); return await execute(command, root, options.signal) } catch (error) { return { passed: false, summary: (error as Error).message } }
        })())
      }
      criteria.push({ ...criterion, status: results.length === 0 ? 'unverified' : results.every(r => r.passed) ? 'passed' : 'failed', summary: results.map(r => r.summary).join('\n') || 'No executable acceptance mapped' })
    }
    const command = resolveVerifyCommand(root, loadConfig(root) ?? defaultConfig('1.6.2'))
    if (command) {
      let result: VerifyResult
      try { if (options.signal?.aborted) throw new Error('Verification cancelled or deadline reached'); result = await execute(command, root, options.signal) } catch (error) { result = { passed: false, summary: (error as Error).message } }
      criteria.push({ id: 'project-suite', text: 'Configured project verification', commands: [command], status: result.passed ? 'passed' : 'failed', summary: result.summary })
    }
    if (options.requirement) criteria.push({ id: 'requested-outcome', text: options.requirement, commands: [], status: 'unverified', summary: 'Map this outcome to executable criteria in .yoke/acceptance.yaml; a green suite alone is not proof of this requirement.' })
    if (criteria.length === 0) criteria.push({ id: 'acceptance', text: 'Project acceptance', commands: [], status: 'unverified', summary: 'No acceptance manifest or project verification command found' })
  }
  const changed = workspaceFingerprint(root) !== before
  const afterProblem = acceptanceProtectionProblem(root)
  if (changed || afterProblem) criteria.push({ id: 'source-integrity', text: 'Checked source remained stable', commands: [], status: 'failed', summary: afterProblem ?? 'Source changed during verification; run check again on a stable tree' })
  if (options.signal?.aborted) criteria.push({ id: 'verification-cancelled', text: 'Verification completed within its allowed run', commands: [], status: 'failed', summary: 'Verification cancelled or deadline reached' })
  const status: CheckStatus = criteria.some(c => c.status === 'failed') ? 'failed' : criteria.some(c => c.status === 'unverified') ? 'unverified' : 'passed'
  const id = randomUUID()
  const evidencePath = statePath(root, 'checks', `${id}.json`)
  const report: CheckReport = { ...(cleanupUnconfirmed ? { cleanupUnconfirmed: true as const } : {}), version: 1, id, generatedAt: new Date().toISOString(), fingerprint: before, status, summary: changed ? 'Source changed during verification' : `${criteria.filter(c => c.status === 'passed').length}/${criteria.length} checks passed; ${status}`, criteria, durationMs: Date.now() - started, evidencePath }
  mkdirSync(dirname(evidencePath), { recursive: true })
  writeFileSync(evidencePath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return report
}
