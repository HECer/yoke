import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
import * as codeIntelligence from '../../src/code-intelligence/index.js'
import { defaultConfig, saveConfig } from '../../src/retrofit/config.js'

const rtkProcess = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawnSync: (...args: any[]) => args[0] === 'rtk' ? rtkProcess(...args) : (actual.spawnSync as any)(...args) }
})

beforeEach(() => {
  rtkProcess.mockReset().mockImplementation((_command, args, options) => {
    if (JSON.stringify(args) === JSON.stringify(['--version'])) return { status: 0, stdout: 'rtk 0.50.0\n', stderr: '' }
    expect(args).toEqual(['hook', 'codex'])
    expect(JSON.parse(options.input)).toEqual({ hook_event_name: 'PreToolUse', permission_mode: 'default', tool_name: 'Bash', tool_input: { command: 'git status' } })
    return { status: 0, stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { command: 'rtk git status' } } }), stderr: '' }
  })
})

function files(root: string): Record<string, string> {
  return Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => {
    const path = join(entry.parentPath, entry.name)
    return [path, readFileSync(path).toString('base64')]
  }))
}

it('separates active configuration from degraded operational capability without mutating target files', async () => {
  const runToolPreflight = (codeIntelligence as any).runToolPreflight
  expect(runToolPreflight).toBeTypeOf('function')
  const root = mkdtempSync(join(tmpdir(), 'yoke-tool-preflight-'))
  const server = join(root, 'backend.mjs')
  writeFileSync(server, `import { writeFileSync } from 'node:fs'; import { createInterface } from 'node:readline';
createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line); if(m.id===undefined)return;
 writeFileSync('probe-side-effect.txt', 'backend initialized');
 const result=m.method==='initialize'?{protocolVersion:'2025-11-25'}:{tools:[{name:'graft_find_code'},{name:'graft_trace_calls'}]};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
});`)
  saveConfig(root, { ...defaultConfig('test'), codeIntelligence: { mode: 'active', workspaceId: 'configured-project', graft: { command: process.execPath, args: [server] }, graphify: { command: 'yoke-missing-backend', args: [] }, serena: { command: 'yoke-missing-backend', args: [] } } })
  const before = files(root)
  try {
    const report = await runToolPreflight(root, { timeoutMs: 2000 })
    expect(report.codeIntelligence).toMatchObject({ mode: 'active', workspaceId: 'configured-project', status: 'degraded', indexFreshness: 'unverified' })
    expect(report.codeIntelligence.backends.graft).toMatchObject({ status: 'unprobed', tools: [] })
    expect(report.codeIntelligence.backends.graphify.status).toBe('unprobed')
    expect(report.codeIntelligence.backends['serena-lsp'].status).toBe('unprobed')
    expect(report.codeIntelligence.fallback).toContain('source')
    expect(report.rtk).toMatchObject({ status: 'available', hookRegistration: 'missing', nestedCodeMode: 'unverified' })
    expect(report.rtk.version).toMatch(/^rtk \d/)
    expect(rtkProcess).toHaveBeenCalledTimes(2)
    expect(files(root)).toEqual(before)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it('reports missing default backends separately from active configuration', async () => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-tool-missing-'))
  saveConfig(root, { ...defaultConfig('test'), codeIntelligence: { mode: 'active' } })
  const before = files(root)
  vi.stubEnv('PATH', '')
  rtkProcess.mockImplementation(() => ({ status: null, stdout: null, stderr: null, error: Object.assign(new Error('spawnSync rtk ENOENT'), { code: 'ENOENT' }) }))
  try {
    const report = await (codeIntelligence as any).runToolPreflight(root)
    expect(report.codeIntelligence).toMatchObject({ mode: 'active', status: 'degraded' })
    expect(Object.values(report.codeIntelligence.backends).map((backend: any) => backend.status)).toEqual(['unavailable', 'unavailable', 'unavailable'])
    expect(report.rtk).toMatchObject({ status: 'degraded', version: null, nativeRewrite: false })
    expect(files(root)).toEqual(before)
  } finally { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }) }
})

it('reports native registration separately from whether this host activates project hooks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-tool-registered-'))
  mkdirSync(join(root, '.codex'))
  writeFileSync(join(root, '.codex/hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook codex' }] }] } }))
  try {
    const report = await (codeIntelligence as any).runToolPreflight(root)
    expect(report.rtk).toMatchObject({ hookRegistration: 'configured', hostActivation: 'unverified' })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
