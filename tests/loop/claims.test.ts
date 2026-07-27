import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireClaim, cleanupClaims, releaseClaim } from '../../src/loop/claims.js'
let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-claim-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))
describe('story claims', () => {
  it('acquires atomically and only the owner releases', () => {
    expect(acquireClaim(dir, 'S1', 'dispatcher-a')).not.toBeNull()
    expect(acquireClaim(dir, 'S1', 'dispatcher-b')).toBeNull()
    expect(releaseClaim(dir, 'S1', 'dispatcher-b')).toBe(false)
    expect(releaseClaim(dir, 'S1', 'dispatcher-a')).toBe(true)
  })
  it('takes over stale claims and cleans only the requested owner', () => {
    acquireClaim(dir, 'S1', 'old', { now: new Date(0) })
    expect(acquireClaim(dir, 'S1', 'new', { now: new Date(60_000), staleMs: 1 })).toMatchObject({ owner: 'new' })
    acquireClaim(dir, 'S2', 'other')
    expect(cleanupClaims(dir, 'new')).toBe(1)
    expect(acquireClaim(dir, 'S2', 'x')).toBeNull()
  })
})
