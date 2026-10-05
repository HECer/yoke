import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { workspaceFingerprint } from '../workspace/fingerprint.js'
import type { VerifyResult } from './verify.js'

export interface VerificationSession {
  run(directory: string, command: string, phase: string, execute: () => VerifyResult, options?: { env?: NodeJS.ProcessEnv; policyKey?: string }): VerifyResult
  stats(): { executed: number; reused: number }
}

function identity(directory: string, command: string, phase: string, env: NodeJS.ProcessEnv, policyKey = ''): string | undefined {
  try {
    const hash = createHash('sha256').update(JSON.stringify({
      root: resolve(directory), command, phase, policyKey, node: process.version, platform: process.platform, arch: process.arch,
      environment: Object.entries(env).sort(([a], [b]) => a.localeCompare(b)),
      workspace: workspaceFingerprint(directory),
    }))
    // Installed tools are mutable environment, even when node_modules is ignored.
    // Large/linked environments disable reuse rather than weaken identity checks.
    let bytes = 0, files = 0
    const digest = (path: string): void => {
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) throw Error('Linked dependency identity is not reusable')
      if (stat.isDirectory()) {
        hash.update(JSON.stringify({ path, type: 'directory' }) + '\n')
        for (const name of readdirSync(path).sort()) { if (name !== '.git') digest(join(path, name)) }
        return
      }
      if (!stat.isFile() || ++files > 10000 || (bytes += stat.size) > 64 * 1024 * 1024) throw Error('Dependency identity exceeds its budget')
      const content = readFileSync(path)
      hash.update(JSON.stringify({ path, type: 'file', bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') }) + '\n')
    }
    // The runtime has its own budget; Windows node.exe can exceed the entire
    // dependency quota. Hash its bytes without weakening tool identity.
    hash.update(JSON.stringify({ runtime: process.execPath, sha256: createHash('sha256').update(readFileSync(process.execPath)).digest('hex') }) + '\n')
    // Pure commands can read ignored local fixtures, build output or .env files.
    // Hash all local inputs rather than equating a clean Git tree with identity.
    digest(resolve(directory))
    return hash.digest('hex')
  } catch { return undefined }
}

/** Explicit run-local reuse. Independent integration/completion never uses this cache. */
export function createVerificationSession(): VerificationSession {
  const results = new Map<string, VerifyResult>()
  let executed = 0, reused = 0
  return {
    run(directory, command, phase, execute, options = {}) {
      const eligible = phase === 'criterion' || phase === 'verify'
      const before = eligible ? identity(directory, command, phase, options.env ?? process.env, options.policyKey) : undefined
      if (before && results.has(before)) { reused++; return { ...results.get(before)! } }
      executed++
      const result = execute()
      if (result.passed && before && before === identity(directory, command, phase, options.env ?? process.env, options.policyKey)) {
        if (results.size >= 128) results.delete(results.keys().next().value!)
        results.set(before, { ...result })
      }
      return result
    },
    stats: () => ({ executed, reused }),
  }
}
