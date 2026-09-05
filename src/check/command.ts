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
}
export interface CheckOptions {
  requirement?: string
  execute?: (command: string, root: string) => VerifyResult
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
