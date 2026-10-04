import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../retrofit/config.js'
import { workspaceId } from './snapshots.js'
import { createGraftAdapter, createGraphifyAdapter, createSerenaAdapter } from './adapters/index.js'

export interface BackendPreflight {
  status: 'available' | 'unavailable' | 'unprobed'
  tools: string[]
  missingTools: string[]
  reason?: string
}

/** Probe protocol capabilities in an empty disposable cwd, never create a target snapshot.
 * Configured commands are arbitrary code and cannot be promised read-only: leave them unprobed. */
export async function runToolPreflight(root: string, options: { timeoutMs?: number } = {}) {
  const configured = loadConfig(root)?.codeIntelligence
  const timeout = Math.min(10000, Math.max(100, options.timeoutMs ?? 2000))
  const version = spawnSync('rtk', ['--version'], { encoding: 'utf8', timeout })
  const native = spawnSync('rtk', ['hook', 'codex'], {
    encoding: 'utf8', timeout,
    input: JSON.stringify({ hook_event_name: 'PreToolUse', permission_mode: 'default', tool_name: 'Bash', tool_input: { command: 'git status' } }),
  })
  let nativeRewrite = false
  try { const result = JSON.parse(native.stdout); nativeRewrite = native.status === 0 && result.hookSpecificOutput?.permissionDecision === 'allow' && result.hookSpecificOutput?.updatedInput?.command === 'rtk git status' } catch { /* native support unavailable */ }
  let hookRegistration: 'configured' | 'missing' | 'invalid' = 'missing'
  const hooksPath = join(root, '.codex/hooks.json')
  if (existsSync(hooksPath)) {
    try {
      const hooks = JSON.parse(readFileSync(hooksPath, 'utf8')).hooks?.PreToolUse
      if (Array.isArray(hooks) && hooks.some(block => ['Bash', '^Bash$'].includes(block.matcher) && Array.isArray(block.hooks) && block.hooks.some((hook: any) => hook.type === 'command' && hook.command === 'rtk hook codex'))) hookRegistration = 'configured'
    } catch { hookRegistration = 'invalid' }
  }
  const mode = configured?.mode ?? 'off'
  const probeRoot = mkdtempSync(join(tmpdir(), 'yoke-tool-probe-'))
  const backends: Record<string, BackendPreflight> = {}
  const definitions = [
    ['graft', configured?.graft, createGraftAdapter, ['graft_find_code', 'graft_trace_calls']],
    ['graphify', configured?.graphify, createGraphifyAdapter, ['query_graph', 'get_node']],
    ['serena-lsp', configured?.serena, createSerenaAdapter, ['find_symbol', 'find_referencing_symbols']],
  ] as const
  try {
    for (const [name, custom, factory, required] of definitions) {
      if (mode === 'off' || custom) {
        backends[name] = { status: 'unprobed', tools: [], missingTools: [...required], reason: mode === 'off' ? 'Configured mode is off.' : 'Custom command/arguments were not executed; read-only behavior cannot be verified.' }
        continue
      }
      const adapter = factory(probeRoot)
      try {
        const tools = await adapter.probe(timeout)
        const missingTools = required.filter(tool => !tools.includes(tool))
        backends[name] = { status: missingTools.length ? 'unavailable' : 'available', tools, missingTools }
      } catch {
        backends[name] = { status: 'unavailable', tools: [], missingTools: [...required], reason: 'Backend protocol initialization or tools/list failed; target indexing was not attempted.' }
      } finally { await adapter.close() }
    }
  } finally { rmSync(probeRoot, { recursive: true, force: true }) }
  return {
    rtk: { status: nativeRewrite ? 'available' as const : 'degraded' as const, version: version.status === 0 ? version.stdout.trim() : null, nativeRewrite, hookRegistration, hostActivation: 'unverified' as const, nestedCodeMode: 'unverified' as const, fallback: nativeRewrite ? 'Explicit RTK prefixes remain required for unverified nested code-mode calls; project-hook activation depends on host support and trust.' : 'Use explicit RTK prefixes; update RTK outside this preflight if native Codex support is needed. Use rtk init --codex --dry-run to inspect supported setup flags.' },
    codeIntelligence: { mode, workspaceId: configured?.workspaceId ?? workspaceId(root), status: mode === 'off' ? 'off' as const : Object.values(backends).every(backend => backend.status === 'available') ? 'available' as const : 'degraded' as const, backends, probeScope: 'isolated protocol capabilities only' as const, indexFreshness: 'unverified' as const, fallback: 'Use rg and direct source reads; verify backend candidates against source. Target index freshness and exhaustive coverage are unverified.' },
  }
}
