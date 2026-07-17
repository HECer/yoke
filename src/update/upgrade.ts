import { execSync } from 'node:child_process'
import { readCache, isNewer, currentYokeVersion } from './check.js'

export interface UpgradeOpts {
  exec?: (cmd: string) => void
  cacheFile?: string
}

// `yoke upgrade` — the explicit path to the latest release.
export function runUpgrade(opts: UpgradeOpts = {}): number {
  const exec = opts.exec ?? ((cmd: string) => { execSync(cmd, { stdio: 'inherit' }) })
  console.log('Upgrading @hecer/yoke to latest...')
  try {
    exec('npm install -g @hecer/yoke@latest')
  } catch (e) {
    console.error(`Upgrade failed: ${(e as Error).message}`)
    console.error('Running from a git clone? Upgrade with: git pull && npm install && npm run build')
    return 1
  }
  console.log('✓ upgraded — the new version is active on the next yoke invocation.')
  return 0
}

// Opt-in auto-upgrade (`update.auto: true` in .yoke/config.yaml), evaluated at
// loop START only — never mid-run: the current process keeps executing the
// version it started with; the upgrade takes effect on the next invocation.
export function maybeAutoUpgrade(auto: boolean | undefined, opts: UpgradeOpts = {}): void {
  if (auto !== true) return
  const cache = readCache(opts.cacheFile)
  const current = currentYokeVersion()
  if (cache && isNewer(cache.latest, current)) {
    console.error(`update.auto: upgrading yoke ${current} → ${cache.latest} (this run continues on ${current}; the upgrade applies from the next run)`)
    runUpgrade(opts)
  }
}
