import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireClaim, cleanupClaims, heartbeatClaim, readClaim, releaseClaim, requestClaimCancellation } from '../../src/loop/claims.js'
import { acquireClaimOperation } from '../../src/loop/claim-lease.js'
import { storyPathSegment } from '../../src/loop/prd.js'

let dir: string

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-claim-')) })

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('story claims', () => {
  it('acquires a complete versioned claim atomically and only its owner token releases it', () => {
    const claim = acquireClaim(dir, 'S1', 'dispatcher-a', {
      now: new Date(1_000),
      pid: 4242,
      dispatcherId: 'dispatcher-a',
      ownerToken: 'owner-token-a',
      baseCommit: 'abc123',
      worktree: join(dir, '.yoke', 'worktrees', 'S1'),
      provider: 'codex',
      model: 'gpt-5.6-terra',
      role: 'implementation',
    })

    expect(claim).toMatchObject({
      schemaVersion: 2,
      storyId: 'S1',
      dispatcherId: 'dispatcher-a',
      owner: 'owner-token-a',
      ownerToken: 'owner-token-a',
      pid: 4242,
      baseCommit: 'abc123',
      worktree: join(dir, '.yoke', 'worktrees', 'S1'),
      provider: 'codex',
      model: 'gpt-5.6-terra',
      role: 'implementation',
      claimedAt: new Date(1_000).toISOString(),
      heartbeatAt: new Date(1_000).toISOString(),
    })
    expect(acquireClaim(dir, 'S1', 'dispatcher-b', { now: new Date(1_001) })).toBeNull()
    expect(releaseClaim(dir, 'S1', 'dispatcher-a')).toBe(false)
    expect(releaseClaim(dir, 'S1', 'owner-token-a')).toBe(true)
  })

  it('reads and mutates a legacy claim by parsed story id, not filename', () => {
    const storyId = 'Auth callback: ../../outside'
    const legacyClaim = join(dir, '.yoke', 'claims', 'legacy.json')
    const operation = `${legacyClaim}.operation`
    const recovery = `${operation}.recovery`
    mkdirSync(join(dir, '.yoke', 'claims'), { recursive: true })
    writeFileSync(legacyClaim, JSON.stringify({ storyId, owner: 'dispatcher-a', pid: 4242, claimedAt: new Date(0).toISOString() }))
    writeFileSync(operation, JSON.stringify({ schemaVersion: 1, token: '00000000-0000-4000-8000-000000000098', pid: 4242, createdAt: new Date(0).toISOString() }))
    writeFileSync(recovery, JSON.stringify({ schemaVersion: 1, token: '00000000-0000-4000-8000-000000000099', pid: 4242, createdAt: new Date(0).toISOString() }))

    expect(readClaim(dir, storyId)).toMatchObject({ storyId, owner: 'dispatcher-a', pid: 4242 })
    expect(heartbeatClaim(dir, storyId, 'dispatcher-a', { now: new Date(1_000) })).toBeNull()
    expect(readFileSync(recovery, 'utf8')).toContain('00000000-0000-4000-8000-000000000099')
    rmSync(operation, { force: true })
    rmSync(recovery, { force: true })
    expect(heartbeatClaim(dir, storyId, 'dispatcher-a', { now: new Date(1_000) })).toMatchObject({
      heartbeatAt: new Date(1_000).toISOString(),
    })
    expect(requestClaimCancellation(dir, storyId, 'dispatcher-a', 'pause', { now: new Date(2_000) })).toMatchObject({
      cancellation: { reason: 'pause', requestedAt: new Date(2_000).toISOString() },
    })
    expect(releaseClaim(dir, storyId, 'dispatcher-a')).toBe(true)
  })

  it('updates every duplicate same-owner claim during heartbeat and cancellation', () => {
    const storyId = 'Auth callback: ../../outside'
    const claimsDir = join(dir, '.yoke', 'claims')
    const canonical = join(claimsDir, `${storyPathSegment(storyId)}.json`)
    const legacy = join(claimsDir, 'legacy.json')
    mkdirSync(claimsDir, { recursive: true })
    const ownerToken = 'shared-token'
    const heartbeatAt = new Date(1_000)
    const cancellationAt = new Date(2_000)

    writeFileSync(canonical, JSON.stringify({ schemaVersion: 2, storyId, owner: ownerToken, ownerToken, dispatcherId: 'dispatcher-a', pid: 4242, claimedAt: new Date(0).toISOString(), heartbeatAt: new Date(0).toISOString() }))
    writeFileSync(legacy, JSON.stringify({ storyId, owner: ownerToken, pid: 4242, claimedAt: new Date(0).toISOString() }))

    expect(heartbeatClaim(dir, storyId, ownerToken, { now: heartbeatAt, isAlive: () => false })).toMatchObject({ heartbeatAt: heartbeatAt.toISOString() })
    expect(readFileSync(canonical, 'utf8')).toContain(heartbeatAt.toISOString())
    expect(readFileSync(legacy, 'utf8')).toContain(heartbeatAt.toISOString())

    expect(requestClaimCancellation(dir, storyId, ownerToken, 'pause', { now: cancellationAt, isAlive: () => false })).toMatchObject({
      cancellation: { reason: 'pause', requestedAt: cancellationAt.toISOString() },
    })
    expect(readFileSync(canonical, 'utf8')).toContain('pause')
    expect(readFileSync(legacy, 'utf8')).toContain('pause')
  })

  it('removes every duplicate same-owner claim during release', () => {
    const storyId = 'Auth callback: ../../outside'
    const claimsDir = join(dir, '.yoke', 'claims')
    const canonical = join(claimsDir, `${storyPathSegment(storyId)}.json`)
    const legacy = join(claimsDir, 'legacy.json')
    const ownerToken = 'shared-token'
    mkdirSync(claimsDir, { recursive: true })
    writeFileSync(canonical, JSON.stringify({ schemaVersion: 2, storyId, owner: ownerToken, ownerToken, dispatcherId: 'dispatcher-a', pid: 4242, claimedAt: new Date(0).toISOString(), heartbeatAt: new Date(0).toISOString() }))
    writeFileSync(legacy, JSON.stringify({ storyId, owner: ownerToken, pid: 4242, claimedAt: new Date(0).toISOString() }))

    expect(releaseClaim(dir, storyId, ownerToken, { isAlive: () => false })).toBe(true)
    expect(existsSync(canonical)).toBe(false)
    expect(existsSync(legacy)).toBe(false)
  })

  it('rejects takeover when stale canonical and live legacy claims share a story', () => {
    const storyId = 'Auth callback: ../../outside'
    const claimsDir = join(dir, '.yoke', 'claims')
    const canonical = join(claimsDir, `${storyPathSegment(storyId)}.json`)
    const legacy = join(claimsDir, 'legacy.json')
    mkdirSync(claimsDir, { recursive: true })
    writeFileSync(canonical, JSON.stringify({ schemaVersion: 2, storyId, owner: 'stale-canonical', ownerToken: 'stale-canonical', dispatcherId: 'dispatcher-a', pid: 4242, claimedAt: new Date(0).toISOString(), heartbeatAt: new Date(0).toISOString() }))
    writeFileSync(legacy, JSON.stringify({ storyId, owner: 'live-legacy', pid: 4243, claimedAt: new Date(0).toISOString() }))

    expect(acquireClaim(dir, storyId, 'new-owner', { now: new Date(60_000), staleMs: 1, ownerToken: 'new-token', isAlive: pid => pid === 4243 })).toBeNull()
  })

  it('takes over only expired claims whose owner process is no longer alive', () => {
    const expiredAt = new Date(0)
    const takeoverAt = new Date(60_000)
    const deadOwner = () => false
    const liveOwner = () => true

    acquireClaim(dir, 'S1', 'old', { now: expiredAt, pid: 4242, ownerToken: 'old-token' })
    expect(acquireClaim(dir, 'S1', 'new', { now: takeoverAt, staleMs: 1, isAlive: liveOwner })).toBeNull()
    expect(acquireClaim(dir, 'S1', 'new', {
      now: takeoverAt,
      staleMs: 1,
      isAlive: deadOwner,
      ownerToken: 'new-token',
    })).toMatchObject({ ownerToken: 'new-token', heartbeatAt: takeoverAt.toISOString() })
  })

  it('rewrites duplicate legacy and canonical stale claims into one canonical acquisition', () => {
    const storyId = 'Auth callback: ../../outside'
    const claimsDir = join(dir, '.yoke', 'claims')
    const canonical = join(claimsDir, `${storyPathSegment(storyId)}.json`)
    const legacy = join(claimsDir, 'legacy.json')
    mkdirSync(claimsDir, { recursive: true })
    writeFileSync(canonical, JSON.stringify({ storyId, owner: 'old-canonical', pid: 4242, claimedAt: new Date(0).toISOString() }))
    writeFileSync(legacy, JSON.stringify({ storyId, owner: 'old-legacy', pid: 4242, claimedAt: new Date(0).toISOString() }))

    const claim = acquireClaim(dir, storyId, 'new-owner', { now: new Date(60_000), staleMs: 1, ownerToken: 'new-token', isAlive: () => false })

    expect(claim).toMatchObject({ storyId, ownerToken: 'new-token' })
    expect(readFileSync(canonical, 'utf8')).toContain('new-token')
    expect(existsSync(legacy)).toBe(false)
  })

  it('routes operation leases through the resolved legacy claim path', () => {
    const storyId = 'Auth callback: ../../outside'
    const claimsDir = join(dir, '.yoke', 'claims')
    const legacy = join(claimsDir, 'legacy.json')
    const operation = `${legacy}.operation`
    const recovery = `${legacy}.operation.recovery`
    mkdirSync(claimsDir, { recursive: true })
    writeFileSync(legacy, JSON.stringify({ storyId, owner: 'dispatcher-a', pid: 4242, claimedAt: new Date(0).toISOString() }))
    writeFileSync(operation, JSON.stringify({ schemaVersion: 1, token: '00000000-0000-4000-8000-000000000098', pid: 4242, createdAt: new Date(0).toISOString() }))
    writeFileSync(recovery, JSON.stringify({ schemaVersion: 1, token: '00000000-0000-4000-8000-000000000099', pid: 4242, createdAt: new Date(0).toISOString() }))

    expect(heartbeatClaim(dir, storyId, 'dispatcher-a', { now: new Date(1_000) })).toBeNull()
    expect(readFileSync(recovery, 'utf8')).toContain('00000000-0000-4000-8000-000000000099')
  })

  it('recovers a dead expired operation lease but never steals a live one', () => {
    const file = join(dir, '.yoke', 'claims', `${storyPathSegment('S1')}.json`)
    const operation = `${file}.operation`
    const expiredAt = new Date(0)
    const now = new Date(60_000)
    const lease = { schemaVersion: 1, token: '00000000-0000-4000-8000-000000000001', pid: 4242, createdAt: expiredAt.toISOString() }

    acquireClaim(dir, 'S1', 'dispatcher-a', { now: expiredAt, ownerToken: 'owner-token-a' })
    mkdirSync(join(dir, '.yoke', 'claims'), { recursive: true })
    writeFileSync(operation, JSON.stringify(lease))
    expect(heartbeatClaim(dir, 'S1', 'owner-token-a', { now, staleMs: 1, isAlive: () => false })).toMatchObject({
      heartbeatAt: now.toISOString(),
    })

    writeFileSync(operation, JSON.stringify(lease))
    expect(heartbeatClaim(dir, 'S1', 'owner-token-a', { now: new Date(120_000), staleMs: 1, isAlive: () => true })).toBeNull()
  })

  it('ignores malformed and mismatched files during cleanup', () => {
    const claimsDir = join(dir, '.yoke', 'claims')
    const malformed = join(claimsDir, 'broken.json')
    const mismatched = join(claimsDir, 'wrong-name.json')
    mkdirSync(claimsDir, { recursive: true })
    writeFileSync(malformed, '{')
    writeFileSync(mismatched, JSON.stringify({ storyId: 'different-story', owner: 'dispatcher-a', pid: 4242, claimedAt: new Date(0).toISOString() }))

    expect(cleanupClaims(dir, 'dispatcher-a')).toBe(1)
    expect(existsSync(malformed)).toBe(true)
    expect(existsSync(mismatched)).toBe(false)
  })

  it('reclaims a dead expired recovery lease before acquiring the operation lease', () => {
    const file = join(dir, '.yoke', 'claims', 'S1.json')
    const operation = `${file}.operation`
    const recovery = `${operation}.recovery`
    const now = new Date(60_000)
    const stale = { schemaVersion: 1, token: '00000000-0000-4000-8000-000000000001', pid: 4242, createdAt: new Date(0).toISOString() }

    mkdirSync(join(dir, '.yoke', 'claims'), { recursive: true })
    writeFileSync(operation, JSON.stringify(stale))
    writeFileSync(recovery, JSON.stringify(stale))

    expect(acquireClaimOperation(file, { now, staleMs: 1, isAlive: () => false })).not.toBeNull()
    expect(existsSync(recovery)).toBe(false)
  })

  it('refuses a live recovery lease even when the operation lease is dead', () => {
    const file = join(dir, '.yoke', 'claims', 'S1.json')
    const operation = `${file}.operation`
    const recovery = `${operation}.recovery`
    const now = new Date(60_000)
    const stale = { schemaVersion: 1, token: '00000000-0000-4000-8000-000000000001', pid: 4242, createdAt: new Date(0).toISOString() }
    const live = { schemaVersion: 1, token: '00000000-0000-4000-8000-000000000002', pid: 4243, createdAt: new Date(0).toISOString() }

    mkdirSync(join(dir, '.yoke', 'claims'), { recursive: true })
    writeFileSync(operation, JSON.stringify(stale))
    writeFileSync(recovery, JSON.stringify(live))

    expect(acquireClaimOperation(file, { now, staleMs: 1, isAlive: pid => pid === 4243 })).toBeNull()
    expect(readFileSync(recovery, 'utf8')).toContain(live.token)
  })

  it('refuses removal when a recovery lease token changes before the final comparison', () => {
    const file = join(dir, '.yoke', 'claims', 'S1.json')
    const operation = `${file}.operation`
    const recovery = `${operation}.recovery`
    const now = new Date(60_000)
    const stale = { schemaVersion: 1, token: '00000000-0000-4000-8000-000000000001', pid: 4242, createdAt: new Date(0).toISOString() }
    const replacement = { schemaVersion: 1, token: '00000000-0000-4000-8000-000000000003', pid: 4243, createdAt: now.toISOString() }

    mkdirSync(join(dir, '.yoke', 'claims'), { recursive: true })
    writeFileSync(operation, JSON.stringify(stale))
    writeFileSync(recovery, JSON.stringify(stale))

    expect(acquireClaimOperation(file, {
      now,
      staleMs: 1,
      isAlive: pid => pid === replacement.pid,
      filesystem: { beforeRecoveryRemove: () => writeFileSync(recovery, JSON.stringify(replacement)) },
    })).toBeNull()
    expect(readFileSync(recovery, 'utf8')).toContain(replacement.token)
  })

  it('allows at most one contender to recover the same stale operation lease', () => {
    const file = join(dir, '.yoke', 'claims', 'S1.json')
    const operation = `${file}.operation`
    const recovery = `${operation}.recovery`
    const now = new Date(60_000)
    const stale = { schemaVersion: 1, token: '00000000-0000-4000-8000-000000000001', pid: 4242, createdAt: new Date(0).toISOString() }

    mkdirSync(join(dir, '.yoke', 'claims'), { recursive: true })
    writeFileSync(operation, JSON.stringify(stale))
    writeFileSync(recovery, JSON.stringify(stale))

    let nested: string | null = null
    const first = acquireClaimOperation(file, {
      now,
      staleMs: 1,
      isAlive: () => false,
      filesystem: { beforeRecoveryRemove: () => { nested = acquireClaimOperation(file, { now, staleMs: 1, isAlive: () => false }) } },
    })
    expect([first, nested].filter(token => token !== null)).toHaveLength(1)
  })

  it('cleans only parsed valid claim files for the requested owner', () => {
    acquireClaim(dir, 'S1', 'new', { ownerToken: 'new-token' })
    acquireClaim(dir, 'S2', 'other')
    mkdirSync(join(dir, '.yoke', 'claims'), { recursive: true })
    writeFileSync(join(dir, '.yoke', 'claims', 'broken.json'), '{')
    expect(cleanupClaims(dir, 'new-token')).toBe(1)
    expect(acquireClaim(dir, 'S2', 'x')).toBeNull()
  })
})
