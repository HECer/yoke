import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import type { CheckCriterion, CheckStatus } from './command.js'

const References = z.array(z.string().min(1).max(120)).min(1).max(200)
export const DeliverySchema = z.object({
  version: z.literal(1),
  artifacts: z.array(z.object({ path: z.string().min(1).max(1000), criteria: References }).strict()).max(32).default([]),
  journeys: z.array(z.object({ id: z.string().min(1).max(120), text: z.string().min(1).max(8000), criteria: References }).strict()).max(100).default([]),
  environment: z.object({ name: z.string().min(1).max(200), url: z.string().url().max(2000).optional() }).strict().optional(),
}).strict().superRefine((value, context) => {
  if (new Set(value.artifacts.map(item => item.path)).size !== value.artifacts.length) context.addIssue({ code: 'custom', message: 'Duplicate delivery artifact path' })
  if (new Set(value.journeys.map(item => item.id)).size !== value.journeys.length) context.addIssue({ code: 'custom', message: 'Duplicate delivery journey id' })
})
type Delivery = z.infer<typeof DeliverySchema>
interface ArtifactSnapshot { sha256?: string; bytes?: number; problem?: string }
export interface DeliveryStart { acceptanceDigest: string | null; artifacts: ArtifactSnapshot[] }
export const DELIVERY_HASH_LIMITS = Object.freeze({ fileBytes: 512 * 1024 * 1024, totalBytes: 1024 * 1024 * 1024, timeoutMs: 10_000 })
interface SnapshotOptions { signal?: AbortSignal; deadline?: number }
interface SnapshotBudget extends SnapshotOptions { remaining: number; deadline: number }
export interface DeliveryEvidence {
  version: 1
  sourceFingerprint: string
  acceptanceDigest: string | null
  bindingProblem?: string
  environment: { platform: string; architecture: string; nodeVersion: string; declared?: Delivery['environment'] }
  artifacts: Array<{ path: string; criteria: string[]; binding: 'declared-criteria'; status: CheckStatus; stable: boolean; sha256?: string; bytes?: number; afterSha256?: string; summary: string }>
  journeys: Array<{ id: string; text: string; criteria: string[]; status: CheckStatus }>
  passedRequirementIds: string[]
  failedRequirementIds: string[]
  unverifiedRequirementIds: string[]
}

function snapshotBudget(options: SnapshotOptions): SnapshotBudget {
  return { signal: options.signal, remaining: DELIVERY_HASH_LIMITS.totalBytes, deadline: Math.min(options.deadline ?? Infinity, Date.now() + DELIVERY_HASH_LIMITS.timeoutMs) }
}
function checkBudget(budget: SnapshotBudget): void {
  if (budget.signal?.aborted || Date.now() >= budget.deadline) throw Error('Artifact hashing cancelled or deadline reached')
}
function artifactPath(root: string, path: string): string {
  if (isAbsolute(path)) throw Error('Artifact path must be relative')
  const full = resolve(root, path), rel = relative(root, full)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw Error('Artifact path escapes project')
  let current = root
  for (const component of rel.split(sep)) {
    current = join(current, component)
    if (lstatSync(current).isSymbolicLink()) throw Error('Artifact paths must not contain symbolic links')
  }
  if (realpathSync(full) !== full) throw Error('Artifact path is not canonical')
  return full
}

/** Bounded bytes and constant memory; the deadline is checked between synchronous reads. */
function snapshotArtifact(root: string, path: string, budget: SnapshotBudget): ArtifactSnapshot {
  let fd: number | undefined
  try {
    checkBudget(budget)
    const full = artifactPath(root, path)
    const named = lstatSync(full)
    if (!named.isFile()) throw Error('Artifact must be a regular file')
    if (named.size > DELIVERY_HASH_LIMITS.fileBytes) throw Error(`Artifact exceeds the ${DELIVERY_HASH_LIMITS.fileBytes} byte file limit`)
    if (named.size > budget.remaining) throw Error(`Artifact exceeds the remaining aggregate hash budget (${budget.remaining} bytes)`)
    fd = openSync(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    const before = fstatSync(fd)
    if (!before.isFile() || before.ino !== named.ino || before.dev !== named.dev || before.size !== named.size) throw Error('Artifact changed before hashing')
    const hash = createHash('sha256'), buffer = Buffer.alloc(256 * 1024)
    let bytes = 0
    while (bytes < before.size) {
      checkBudget(budget)
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, before.size - bytes), null)
      if (!count) break
      hash.update(buffer.subarray(0, count)); bytes += count; budget.remaining -= count
    }
    checkBudget(budget)
    const after = fstatSync(fd)
    const finalNamed = lstatSync(artifactPath(root, path))
    if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs ||
      !finalNamed.isFile() || finalNamed.ino !== before.ino || finalNamed.dev !== before.dev || finalNamed.size !== before.size || finalNamed.mtimeMs !== before.mtimeMs || finalNamed.ctimeMs !== before.ctimeMs) throw Error('Artifact changed while hashing')
    return { sha256: hash.digest('hex'), bytes }
  } catch (error) { return { problem: `Artifact cannot be bound: ${(error as Error).message}` } }
  finally { if (fd !== undefined) { try { closeSync(fd) } catch { /* Preserve the snapshot failure. */ } } }
}

export function startDelivery(root: string, manifest: { delivery?: Delivery } | null, acceptanceDigest: string | null, options: SnapshotOptions = {}): DeliveryStart {
  const budget = snapshotBudget(options)
  return { acceptanceDigest, artifacts: (manifest?.delivery?.artifacts ?? []).map(item => snapshotArtifact(root, item.path, budget)) }
}

export function finishDelivery(root: string, manifest: { criteria: Array<{ id: string }>; delivery?: Delivery } | null, start: DeliveryStart, fingerprint: string, criteria: CheckCriterion[], options: SnapshotOptions & { checkIntegrity?: () => string | null } = {}): DeliveryEvidence {
  const budget = snapshotBudget(options)
  const snapshots = (manifest?.delivery?.artifacts ?? []).map((artifact, index) => {
    const before = start.artifacts[index], after = snapshotArtifact(root, artifact.path, budget)
    const stable = !!before?.sha256 && before.sha256 === after.sha256
    const problem = before?.problem ?? after.problem ?? (!stable ? 'Artifact changed during verification; rebuild and check the stable artifact again' : undefined)
    if (problem) criteria.push({ id: `delivery-artifact-${index + 1}`, text: `Artifact ${artifact.path} remained stable`, commands: [], status: 'failed', summary: problem })
    return { artifact, before, after, stable, problem }
  })
  // Recheck source and cancellation after the final artifact I/O, before assigning proof status.
  const bindingProblem = options.checkIntegrity?.() ?? snapshots.find(item => item.problem)?.problem
  const statusFor = (ids: string[]): CheckStatus => {
    const statuses = ids.flatMap(id => { const matches = criteria.filter(criterion => criterion.id === id); return matches.length ? matches.map(item => item.status) : ['unverified' as const] })
    return statuses.some(status => status === 'failed') ? 'failed' : !bindingProblem && statuses.every(status => status === 'passed') ? 'passed' : 'unverified'
  }
  const artifacts = snapshots.map(({ artifact, before, after, stable, problem }) => {
    return { ...artifact, binding: 'declared-criteria' as const, status: problem ? 'failed' as const : statusFor(artifact.criteria), stable, sha256: before?.sha256, bytes: before?.bytes, afterSha256: after.sha256, summary: problem ?? bindingProblem ?? 'Artifact hashes matched before and after checking its declared criteria; the project commands define how this artifact is exercised' }
  })
  const requirements = manifest?.criteria.map(item => item.id) ?? []
  return {
    version: 1, sourceFingerprint: fingerprint, acceptanceDigest: start.acceptanceDigest, ...(bindingProblem ? { bindingProblem } : {}),
    environment: { platform: process.platform, architecture: process.arch, nodeVersion: process.version, declared: manifest?.delivery?.environment },
    artifacts, journeys: (manifest?.delivery?.journeys ?? []).map(journey => ({ ...journey, status: statusFor(journey.criteria) })),
    passedRequirementIds: requirements.filter(id => statusFor([id]) === 'passed'),
    failedRequirementIds: requirements.filter(id => statusFor([id]) === 'failed'),
    unverifiedRequirementIds: requirements.filter(id => statusFor([id]) === 'unverified'),
  }
}
