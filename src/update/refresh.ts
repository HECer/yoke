import { pathToFileURL } from 'node:url'
import { writeCache } from './check.js'

// Detached background refresher (spawned by maybeNotifyUpdate when the cache
// is stale): one small registry request, write the cache, exit. Failures are
// silent by design — the notifier simply retries on a later invocation.

const REGISTRY_LATEST = 'https://registry.npmjs.org/@hecer%2fyoke/latest'

export interface RefreshOpts {
  fetchFn?: typeof fetch
  cacheFile?: string
  now?: Date
  timeoutMs?: number
}

export async function refreshOnce(opts: RefreshOpts = {}): Promise<void> {
  const fetchFn = opts.fetchFn ?? fetch
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 5000)
  try {
    const res = await fetchFn(REGISTRY_LATEST, { signal: ctrl.signal })
    if (!res.ok) return
    const body = await res.json() as { version?: unknown }
    if (typeof body.version === 'string') {
      writeCache({ checkedAt: (opts.now ?? new Date()).toISOString(), latest: body.version }, opts.cacheFile)
    }
  } catch { /* offline / blocked / registry down — silent */ } finally {
    clearTimeout(timer)
  }
}

const isMain = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false
if (isMain) {
  refreshOnce().then(() => process.exit(0))
}
