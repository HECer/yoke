import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface StoryClaim { storyId: string; owner: string; pid: number; claimedAt: string }
const pathFor = (dir: string, id: string) => join(dir, '.yoke', 'claims', `${id}.json`)

export function acquireClaim(dir: string, storyId: string, owner: string, opts: { now?: Date; staleMs?: number; pid?: number } = {}): StoryClaim | null {
  const path = pathFor(dir, storyId)
  mkdirSync(join(dir, '.yoke', 'claims'), { recursive: true })
  const now = opts.now ?? new Date()
  try {
    const old = JSON.parse(readFileSync(path, 'utf8')) as StoryClaim
    if (now.getTime() - Date.parse(old.claimedAt) <= (opts.staleMs ?? 30 * 60_000)) return null
    rmSync(path, { force: true })
  } catch { /* absent or malformed */ }
  const claim = { storyId, owner, pid: opts.pid ?? process.pid, claimedAt: now.toISOString() }
  try {
    const fd = openSync(path, 'wx')
    writeFileSync(fd, JSON.stringify(claim))
    closeSync(fd)
    return claim
  } catch { return null }
}

export function releaseClaim(dir: string, storyId: string, owner: string): boolean {
  const path = pathFor(dir, storyId)
  try {
    const claim = JSON.parse(readFileSync(path, 'utf8')) as StoryClaim
    if (claim.owner !== owner) return false
    rmSync(path, { force: true })
    return true
  } catch { return false }
}

export function cleanupClaims(dir: string, owner?: string): number {
  const claimsDir = join(dir, '.yoke', 'claims')
  let removed = 0
  try {
    for (const file of readdirSync(claimsDir)) {
      const path = join(claimsDir, file)
      try {
        const claim = JSON.parse(readFileSync(path, 'utf8')) as StoryClaim
        if (!owner || claim.owner === owner) { rmSync(path, { force: true }); removed++ }
      } catch { /* scoped cleanup never guesses ownership */ }
    }
  } catch { /* no claims */ }
  return removed
}
