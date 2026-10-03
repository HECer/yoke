import { createHash } from 'node:crypto'
import { workspaceFingerprint } from '../workspace/fingerprint.js'
import type { Story } from './prd.js'

/** Local, per-attempt evidence only. Integration always owns a fresh gate run. */
export interface GateSnapshot<T> {
  readonly identity: string
  readonly evidence: T
}

export function gateIdentity(directory: string, story: Story): string | undefined {
  try {
    return createHash('sha256').update(workspaceFingerprint(directory)).update(JSON.stringify(story)).digest('hex')
  } catch {
    // Unavailable identity disables reuse; it never turns an unchecked state green.
    return undefined
  }
}

export function snapshotGates<T>(directory: string, story: Story, before: string | undefined, evidence: T): GateSnapshot<T> | undefined {
  if (!before || before !== gateIdentity(directory, story)) return undefined
  return { identity: before, evidence }
}

export function reuseGates<T>(directory: string, story: Story, snapshot: GateSnapshot<T> | undefined): T | undefined {
  return snapshot && snapshot.identity === gateIdentity(directory, story) ? snapshot.evidence : undefined
}
