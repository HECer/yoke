import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { z } from 'zod'
import { workspaceFingerprint } from '../workspace/fingerprint.js'
import { statePath } from '../workspace/state.js'
import type { Story } from './prd.js'
import { currentContractKey, readPlanningFile } from '../routing/contracts.js'
import { failureObservation, safeFailure, type FailureObservation } from '../observability/failure.js'

export type FailureStage = 'implementation' | 'criterion' | 'verify' | 'design' | 'perf' | 'audit' | 'quality' | 'integration' | 'completion'
export interface LoopFailure {
  readonly observation?: FailureObservation
  readonly kind: 'completion-failed' | 'verification-failed' | 'no-progress'
  readonly stage: FailureStage
  readonly storyId?: string
  readonly fingerprint?: string
  readonly signature?: string
  readonly repeats?: number
}

const RecordSchema = z.object({
  version: z.literal(1), fingerprint: z.string().regex(/^[a-f0-9]{64}$/u), signature: z.string().regex(/^[a-f0-9]{64}$/u),
  repeats: z.number().int().min(1).max(1_000_000), summary: z.string().max(4096), updatedAt: z.string().datetime(),
}).strict()

function recordPath(root: string, storyId?: string, scope?: string): string {
  const key = createHash('sha256').update(JSON.stringify(storyId ?? null)).digest('hex')
  const suffix = scope === undefined ? '' : `.${createHash('sha256').update(scope).digest('hex')}`
  return statePath(root, 'failure-progress', `${key}${suffix}.json`)
}

function stableFailureSummary(summary: string): string {
  return summary.replace(/\u001b\[[0-9;]*m/gu, '')
    .replace(/\[(?:full|truncated) output:[^\]]*\]/gu, '[saved output]')
    .replace(/\[… omitted; \d+ lines, \d+ bytes total …\]/gu, '[omitted output]')
    .split(/\r?\n/u).map(line => {
      // Known test-reporter metadata is not a different failure. Preserve
      // assertion values, error codes and other numbers in diagnostic content.
      if (/^\s*Start at\s+\d{2}:\d{2}:\d{2}\s*$/u.test(line)) return ''
      if (/^\s*Duration\s+[\d.]+(?:ms|s)\s+\((?:transform|setup|collect|import|tests|environment|prepare)\b.*\)\s*$/u.test(line)) return ''
      if (/^\s*Time:\s+[\d.]+\s*s(?:, estimated [\d.]+\s*s)?\s*$/u.test(line)) return ''
      return /^\s*[✓✔✗✘×❯]\s/u.test(line) ? line.replace(/\s+[\d.]+(?:ms|s)\s*$/u, ' [duration]') : line
    }).join('\n').replace(/\s+/gu, ' ').trim().slice(0, 4096)
}

/** Per-story failure checkpoint, outside isolated workers and independent of provider. */
export function observeFailure(input: {
  root: string; directory: string; story?: Story; stage: FailureStage; summary: string; scope?: string; observation?: FailureObservation
}): { action: 'retry' | 'diagnose' | 'blocked'; feedback: string; failure: LoopFailure } {
  const base: LoopFailure = {
    observation: safeFailure(input.observation) ?? failureObservation(),
    kind: input.stage === 'completion' ? 'completion-failed' : 'verification-failed',
    stage: input.stage, ...(input.story ? { storyId: input.story.id } : {}),
  }
  try {
    const file = recordPath(input.root, input.story?.id, input.scope)
    let previous: z.infer<typeof RecordSchema> | undefined
    try {
      const stat = lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw Error('Invalid failure progress record')
      previous = RecordSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    // Use the same approved parent contract as durable routing reservations:
    // a revised plan/upstream contract must unblock a retained, unchanged worker.
    const contract = input.story ? currentContractKey(input.root, input.story) : readPlanningFile(input.root, '.yoke/plan.md', 80_000) ?? ''
    const fingerprint = createHash('sha256').update(workspaceFingerprint(input.directory)).update(JSON.stringify(input.story ?? null)).update(contract).digest('hex')
    const summary = stableFailureSummary(input.summary)
    const signature = createHash('sha256').update(JSON.stringify([input.stage, summary])).digest('hex')
    const repeats = previous?.fingerprint === fingerprint && previous.signature === signature ? Math.min(1_000_000, previous.repeats + 1) : 1
    const record = RecordSchema.parse({ version: 1, fingerprint, signature, repeats, summary, updatedAt: new Date().toISOString() })
    mkdirSync(dirname(file), { recursive: true })
    const temporary = statePath(input.root, 'failure-progress', `${randomUUID()}.tmp`)
    try {
      writeFileSync(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600 })
      recordPath(input.root, input.story?.id, input.scope)
      renameSync(temporary, file)
    } finally { rmSync(temporary, { force: true }) }
    const failure = { ...base, fingerprint, signature, repeats }
    if (repeats >= 3) return {
      action: 'blocked', failure: { ...failure, kind: 'no-progress' },
      feedback: `Stopped after ${repeats} unchanged failures at ${input.stage}. The diagnostic retry did not change the code, acceptance contract, or failure. Preserve this work and replan or resolve the blocker before automatic continuation. Last failure: ${input.summary}`,
    }
    if (repeats === 2) return {
      action: 'diagnose', failure,
      feedback: `The same ${input.stage} failure occurred twice on unchanged code and acceptance. Before another edit, diagnose the root cause from the saved evidence and use a different, testable hypothesis; do not repeat the previous failed action. One diagnostic attempt remains.\n${input.summary}`,
    }
    return { action: 'retry', failure, feedback: input.summary }
  } catch (error) {
    return { action: 'blocked', failure: { ...base, observation: failureObservation('storage'), kind: 'no-progress' }, feedback: `Failure progress could not be verified; automatic continuation stopped: ${error instanceof Error ? error.message : String(error)}. Last failure: ${input.summary}` }
  }
}

export function clearFailureProgress(root: string, storyId?: string): void {
  const file = recordPath(root, storyId)
  rmSync(file, { force: true })
  let names: string[]
  try { names = readdirSync(dirname(file)) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  const prefix = `${basename(file, '.json')}.`
  for (const name of names) {
    if (name.startsWith(prefix) && /^[a-f0-9]{64}\.json$/u.test(name.slice(prefix.length))) rmSync(statePath(root, 'failure-progress', name), { force: true })
  }
}
