import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProviderInvocation, startProviderProcess } from '../../src/agents/providers.js'
import { defaultConfig, loadConfig, saveConfig, toSolPiNativeConfig } from '../../src/retrofit/config.js'

function withProject(run: (root: string, workspace: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'yoke-solpi-runtime-'))
  const workspace = join(root, '.yoke', 'worktrees', 'story')
  mkdirSync(workspace, { recursive: true })
  saveConfig(root, { ...defaultConfig('test'), solpi: {
    enabled: true,
    actionFusion: true,
    observationPack: false,
    evidencePreservingReducer: true,
    onlineContextCompact: true,
    cacheWriteReadRatio: 2.5,
  } })
  return run(root, workspace).finally(() => rmSync(root, { recursive: true, force: true }))
}

function piInvocation(workspace: string, script: string) {
  const version = vi.spyOn(process, 'version', 'get').mockReturnValue('v22.19.0')
  try {
    const projectInvocation = buildProviderInvocation('pi', 'P', workspace)
    expect(projectInvocation.args).toContain('git:github.com/NVlabs/SoL-Pi@d7ecfc089944f0d04b80122a0a9a6ca0d786f3d0')
    return {
      ...projectInvocation,
      command: process.execPath,
      args: ['-e', script],
      input: '',
    }
  } finally { version.mockRestore() }
}

describe('SoL-Pi runtime config', () => {
  it('solpi-temporary-workspace-config', () => withProject(async (root, workspace) => {
    const settingsPath = join(workspace, '.pi', 'agent', 'settings.json')
    const script = `process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(settingsPath)}, 'utf8'))`
    const invocation = piInvocation(workspace, script)
    expect(invocation.args).toEqual(['-e', script])
    expect(invocation).toMatchObject({ cwd: workspace })

    const result = await startProviderProcess('pi', invocation).completion

    expect(result).toMatchObject({ kind: 'succeeded', stdout: JSON.stringify(toSolPiNativeConfig(loadConfig(root)!)) })
    expect(existsSync(settingsPath)).toBe(false)
    expect(existsSync(join(workspace, '.pi'))).toBe(false)
  }))

  it('solpi-config-restored-after-process', () => withProject(async (root, workspace) => {
    const settingsPath = join(workspace, '.pi', 'agent', 'settings.json')
    const original = Buffer.from('{}');
    const success = piInvocation(workspace, 'process.exit(0)')
    mkdirSync(join(workspace, '.pi', 'agent'), { recursive: true })
    writeFileSync(settingsPath, original)
    expect((await startProviderProcess('pi', success).completion).kind).toBe('succeeded')
    expect(readFileSync(settingsPath)).toEqual(original)

    const spawnFailure = { ...success, command: join(root, 'missing-pi-executable') }
    expect((await startProviderProcess('pi', spawnFailure).completion).kind).toBe('spawn-failed')
    expect(readFileSync(settingsPath)).toEqual(original)

    const controller = new AbortController()
    const cancellation = startProviderProcess('pi', piInvocation(workspace, 'setInterval(() => {}, 1000)'), {
      signal: controller.signal,
      terminationGraceMs: 10,
    })
    controller.abort('runtime test cancellation')
    expect(await cancellation.completion).toMatchObject({ kind: 'cancelled', reason: 'runtime test cancellation' })
    expect(readFileSync(settingsPath)).toEqual(original)
  }), 30_000)

  it('solpi-config-refuses-symlinks', () => withProject(async (_root, workspace) => {
    const outside = mkdtempSync(join(tmpdir(), 'yoke-solpi-outside-'))
    try {
      const outsideSettingsDirectory = join(outside, 'agent')
      mkdirSync(outsideSettingsDirectory)
      const outsideSettings = join(outsideSettingsDirectory, 'settings.json')
      const original = Buffer.from('{"outside":"unchanged"}\n')
      writeFileSync(outsideSettings, original)
      symlinkSync(outside, join(workspace, '.pi'), process.platform === 'win32' ? 'junction' : 'dir')

      const result = await startProviderProcess('pi', piInvocation(workspace, 'process.exit(0)')).completion

      expect(result.kind).toBe('spawn-failed')
      expect(readFileSync(outsideSettings)).toEqual(original)
    } finally { rmSync(outside, { recursive: true, force: true }) }
  }))
})
