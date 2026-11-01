import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { metadataPath, snapshotPolicyHash, type Snapshot, type SnapshotPolicy } from './snapshots.js'

const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024
export function retainEvidence(root: string, snapshot: Snapshot, payload: unknown): { uri: string; cursor: string } {
  const bytes = Buffer.from(JSON.stringify({ workspace_id: snapshot.workspace_id, snapshot_id: snapshot.snapshot_id, policy_hash: snapshot.policy_hash, payload }))
  if (bytes.length > MAX_ARTIFACT_BYTES) throw new Error('Evidence artifact byte budget exceeded; narrow the query')
  const id = createHash('sha256').update(bytes).digest('hex'), file = metadataPath(root, 'evidence', id)
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 }); metadataPath(root, 'evidence', id)
    try { writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  }
  return { uri: `.yoke/code-intelligence/evidence/${id}.json`, cursor: `${id}:0` }
}
export function readEvidence(root: string, workspace: string, cursor: string, policy: SnapshotPolicy = {}): { bytes: Buffer; id: string; offset: number; snapshotId: string } {
  const match = /^([a-f0-9]{64}):([0-9]{1,9})$/.exec(cursor)
  if (!match) throw new Error('invalid evidence cursor')
  const id = match[1]!, offset = Number(match[2]), file = metadataPath(root, 'evidence', id)
  if (!existsSync(file)) throw new Error('unknown evidence artifact')
  if (statSync(file).size > MAX_ARTIFACT_BYTES) throw new Error('evidence artifact byte budget exceeded')
  const bytes = readFileSync(file)
  if (createHash('sha256').update(bytes).digest('hex') !== id) throw new Error('evidence artifact integrity check failed')
  const record = JSON.parse(bytes.toString('utf8'))
  if (record.workspace_id !== workspace || record.policy_hash !== snapshotPolicyHash(policy)) throw new Error('evidence artifact workspace policy has changed')
  if (offset > bytes.length || (offset < bytes.length && (bytes[offset]! & 0xc0) === 0x80)) throw new Error('invalid evidence cursor boundary')
  return { bytes, id, offset, snapshotId: record.snapshot_id }
}
export function utf8End(bytes: Buffer, requestedEnd: number): number {
  let end = Math.min(bytes.length, requestedEnd)
  while (end > 0 && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--
  return end
}
