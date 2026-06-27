import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Walk up from this module to the package root (the dir containing package.json),
// then return its `canon/` directory. Works under both tsx (src/) and built dist/.
export function resolveCanonDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'package.json'))) {
      return join(dir, 'canon')
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('could not locate package root to resolve canon/')
}
