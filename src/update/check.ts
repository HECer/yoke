import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Update check, npm/gh-style: NOTIFY automatically, upgrade on command.
// The check itself never blocks a yoke invocation — a stale cache spawns a
// detached background refresher (refresh.ts) and the hint appears on a LATER
// run from the then-fresh cache. Auto-upgrading by default is deliberately
// NOT done: a gate harness must not change itself mid-project (determinism),
// unreviewed auto-installs are a supply-chain hazard, and `npm i -g` can
// itself fail or stall. Opt in per project via `update.auto` (loop-start only).

export interface UpdateCache { checkedAt: string; latest: string }

export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

// Machine-global (not per-project): one cache under the user's home dir.
export function cachePath(): string {
  return join(homedir(), '.yoke', 'update-check.json')
}

export function readCache(file: string = cachePath()): UpdateCache | null {
  if (!existsSync(file)) return null
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    if (typeof raw.checkedAt === 'string' && typeof raw.latest === 'string') {
      return { checkedAt: raw.checkedAt, latest: raw.latest }
    }
  } catch { /* malformed — treat as absent */ }
  return null
}

export function writeCache(cache: UpdateCache, file: string = cachePath()): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(cache))
}

// Strict numeric triple compare; prerelease suffixes are stripped (a prerelease
// of the same triple is not "newer"). Malformed input is never newer.
export function isNewer(candidate: string, current: string): boolean {
  const triple = (v: string): number[] | null => {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
  }
  const a = triple(candidate)
  const b = triple(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

export function isStale(cache: UpdateCache | null, now: Date): boolean {
  if (!cache) return true
  const t = Date.parse(cache.checkedAt)
  if (!Number.isFinite(t)) return true
  return now.getTime() - t > CHECK_INTERVAL_MS
}

export function currentYokeVersion(): string {
  // src/update/ and dist/update/ both sit two levels below the package root.
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')) as { version: string }
  return pkg.version
}

function spawnDetachedRefresh(): void {
  const refresh = fileURLToPath(new URL('./refresh.js', import.meta.url))
  try {
    spawn(process.execPath, [refresh], { detached: true, stdio: 'ignore' }).unref()
  } catch { /* best-effort — next invocation retries */ }
}

export interface NotifyOpts {
  cacheFile?: string
  env?: Record<string, string | undefined>
  argv?: string[]
  tty?: boolean
  print?: (msg: string) => void
  spawnRefresh?: () => void
  now?: Date
}

// Print (to stderr) a one-line hint when a newer version is cached; kick off a
// detached cache refresh when stale. Silent in CI, --json runs, non-TTY pipes,
// and under YOKE_NO_UPDATE_CHECK=1. Never throws, never blocks.
export function maybeNotifyUpdate(currentVersion: string, opts: NotifyOpts = {}): void {
  const env = opts.env ?? process.env
  if (env.YOKE_NO_UPDATE_CHECK || env.CI) return
  const argv = opts.argv ?? process.argv
  if (argv.includes('--json')) return
  const tty = opts.tty ?? process.stderr.isTTY === true
  if (!tty) return
  const cache = readCache(opts.cacheFile)
  if (isStale(cache, opts.now ?? new Date())) {
    (opts.spawnRefresh ?? spawnDetachedRefresh)()
    return
  }
  if (cache && isNewer(cache.latest, currentVersion)) {
    const print = opts.print ?? ((m: string) => console.error(m))
    print(`yoke ${currentVersion} → ${cache.latest} available — run: yoke upgrade   (disable this check: YOKE_NO_UPDATE_CHECK=1)`)
  }
}
