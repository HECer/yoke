import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function nativeHook(input) {
  const result = spawnSync('rtk', ['hook', 'codex'], { input: JSON.stringify(input), encoding: 'utf8', timeout: 3000 })
  return result.status === 0 && result.stdout.trim() ? JSON.parse(result.stdout) : null
}

export function rewriteHookInput(input, processHook = nativeHook) {
  // Native RTK owns Codex schema, permission-mode handling and fail-open rules.
  try { return processHook(input) ?? null } catch { return null }
}

async function main() {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  try {
    const output = rewriteHookInput(JSON.parse(raw))
    if (output) process.stdout.write(JSON.stringify(output))
  } catch {
    // Compression is an optimization. Malformed input must never block Codex.
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main()
