import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  isNewer, isStale, readCache, writeCache, maybeNotifyUpdate, currentYokeVersion,
  CHECK_INTERVAL_MS, type UpdateCache,
} from '../../src/update/check.js'
import { refreshOnce } from '../../src/update/refresh.js'
import { runUpgrade, maybeAutoUpgrade } from '../../src/update/upgrade.js'
import { YokeConfigSchema } from '../../src/retrofit/config.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-upd-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })
const cacheFile = () => join(dir, 'update-check.json')

describe('isNewer (semver triple compare)', () => {
  it('detects newer versions numerically, not lexicographically', () => {
    expect(isNewer('0.7.0', '0.6.0')).toBe(true)
    expect(isNewer('0.6.1', '0.6.0')).toBe(true)
    expect(isNewer('0.10.0', '0.9.0')).toBe(true) // lexicographic would say false
    expect(isNewer('1.0.0', '0.99.99')).toBe(true)
  })
  it('equal or older is not newer', () => {
    expect(isNewer('0.6.0', '0.6.0')).toBe(false)
    expect(isNewer('0.5.9', '0.6.0')).toBe(false)
  })
  it('ignores prerelease suffixes (base triple only)', () => {
    expect(isNewer('1.0.0-beta.1', '1.0.0')).toBe(false)
    expect(isNewer('1.0.1-rc.1', '1.0.0')).toBe(true)
  })
  it('malformed versions are never "newer"', () => {
    expect(isNewer('banana', '0.6.0')).toBe(false)
    expect(isNewer('', '0.6.0')).toBe(false)
  })
})

describe('cache', () => {
  it('roundtrips and creates the parent dir', () => {
    const nested = join(dir, 'deep', 'update-check.json')
    writeCache({ checkedAt: '2026-07-17T00:00:00Z', latest: '0.7.0' }, nested)
    expect(readCache(nested)).toEqual({ checkedAt: '2026-07-17T00:00:00Z', latest: '0.7.0' })
  })
  it('missing or malformed cache reads as null', () => {
    expect(readCache(cacheFile())).toBeNull()
    writeFileSync(cacheFile(), 'not json')
    expect(readCache(cacheFile())).toBeNull()
  })
  it('isStale: null, malformed date, or older than the interval', () => {
    const now = new Date('2026-07-17T12:00:00Z')
    expect(isStale(null, now)).toBe(true)
    expect(isStale({ checkedAt: 'garbage', latest: '1.0.0' }, now)).toBe(true)
    expect(isStale({ checkedAt: new Date(now.getTime() - CHECK_INTERVAL_MS - 1).toISOString(), latest: '1.0.0' }, now)).toBe(true)
    expect(isStale({ checkedAt: new Date(now.getTime() - 1000).toISOString(), latest: '1.0.0' }, now)).toBe(false)
  })
})

describe('maybeNotifyUpdate', () => {
  const baseOpts = () => ({
    cacheFile: cacheFile(),
    env: {} as Record<string, string | undefined>,
    argv: ['node', 'yoke'],
    tty: true,
    print: vi.fn(),
    spawnRefresh: vi.fn(),
    now: new Date('2026-07-17T12:00:00Z'),
  })
  const freshNewer = (): UpdateCache => ({ checkedAt: '2026-07-17T11:59:00Z', latest: '99.0.0' })

  it('prints one stderr hint when the cached latest is newer', () => {
    writeCache(freshNewer(), cacheFile())
    const o = baseOpts()
    maybeNotifyUpdate('0.6.0', o)
    expect(o.print).toHaveBeenCalledTimes(1)
    expect(String(o.print.mock.calls[0][0])).toContain('99.0.0')
    expect(String(o.print.mock.calls[0][0])).toContain('yoke upgrade')
    expect(o.spawnRefresh).not.toHaveBeenCalled() // cache fresh — no background refresh
  })
  it('spawns the detached refresher when the cache is stale, without blocking', () => {
    const o = baseOpts()
    maybeNotifyUpdate('0.6.0', o) // no cache at all
    expect(o.spawnRefresh).toHaveBeenCalledTimes(1)
    expect(o.print).not.toHaveBeenCalled()
  })
  it('stays silent when up to date', () => {
    writeCache({ checkedAt: '2026-07-17T11:59:00Z', latest: '0.6.0' }, cacheFile())
    const o = baseOpts()
    maybeNotifyUpdate('0.6.0', o)
    expect(o.print).not.toHaveBeenCalled()
  })
  it('is suppressed by YOKE_NO_UPDATE_CHECK, CI, --json, and non-TTY', () => {
    writeCache(freshNewer(), cacheFile())
    for (const patch of [
      { env: { YOKE_NO_UPDATE_CHECK: '1' } },
      { env: { CI: 'true' } },
      { argv: ['node', 'yoke', 'loop', 'run', '--json'] },
      { tty: false },
    ]) {
      const o = { ...baseOpts(), ...patch }
      maybeNotifyUpdate('0.6.0', o)
      expect(o.print).not.toHaveBeenCalled()
      expect(o.spawnRefresh).not.toHaveBeenCalled()
    }
  })
})

describe('refreshOnce', () => {
  it('writes the registry latest into the cache', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '0.9.0' }) })
    await refreshOnce({ fetchFn: fetchFn as never, cacheFile: cacheFile(), now: new Date('2026-07-17T12:00:00Z') })
    expect(readCache(cacheFile())?.latest).toBe('0.9.0')
  })
  it('leaves no cache on HTTP error or network failure', async () => {
    await refreshOnce({ fetchFn: vi.fn().mockResolvedValue({ ok: false }) as never, cacheFile: cacheFile() })
    await refreshOnce({ fetchFn: vi.fn().mockRejectedValue(new Error('offline')) as never, cacheFile: cacheFile() })
    expect(existsSync(cacheFile())).toBe(false)
  })
})

describe('runUpgrade', () => {
  it('runs the global npm install and returns 0', () => {
    const exec = vi.fn()
    expect(runUpgrade({ exec })).toBe(0)
    expect(String(exec.mock.calls[0][0])).toContain('npm install -g @hecer/yoke@latest')
  })
  it('returns 1 and points at the git-clone path when npm fails', () => {
    const exec = vi.fn(() => { throw new Error('E401') })
    expect(runUpgrade({ exec })).toBe(1)
  })
})

describe('maybeAutoUpgrade (loop-start hook)', () => {
  it('does nothing when auto is off or cache is not newer', () => {
    const exec = vi.fn()
    maybeAutoUpgrade(undefined, { exec, cacheFile: cacheFile() })
    maybeAutoUpgrade(false, { exec, cacheFile: cacheFile() })
    writeCache({ checkedAt: new Date().toISOString(), latest: '0.0.1' }, cacheFile())
    maybeAutoUpgrade(true, { exec, cacheFile: cacheFile() })
    expect(exec).not.toHaveBeenCalled()
  })
  it('upgrades when auto is on and a newer version is cached', () => {
    writeCache({ checkedAt: new Date().toISOString(), latest: '99.0.0' }, cacheFile())
    const exec = vi.fn()
    maybeAutoUpgrade(true, { exec, cacheFile: cacheFile() })
    expect(exec).toHaveBeenCalledTimes(1)
  })
})

describe('wiring', () => {
  it('currentYokeVersion reads the real package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(currentYokeVersion()).toBe(pkg.version)
  })
  it('config schema accepts update.auto', () => {
    const cfg = YokeConfigSchema.parse({
      canonVersion: '1', agents: [], loop: { enabled: false }, update: { auto: true },
    })
    expect(cfg.update?.auto).toBe(true)
  })
})
