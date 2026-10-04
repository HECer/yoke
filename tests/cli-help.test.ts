import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../src/cli.js'
import { runSetup } from '../src/setup/command.js'
import { runRetrofit } from '../src/retrofit/command.js'

vi.mock('../src/setup/command.js', () => ({ runSetup: vi.fn(() => 0) }))
vi.mock('../src/retrofit/command.js', () => ({ runRetrofit: vi.fn(() => 0) }))

let dir: string
function snapshot(path: string): Record<string, string> {
  return Object.fromEntries(readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const file = join(path, entry.name)
    return entry.isDirectory()
      ? Object.entries(snapshot(file)).map(([name, bytes]) => [entry.name + '/' + name, bytes])
      : [[entry.name, readFileSync(file).toString('base64')]]
  }))
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  dir = mkdtempSync(join(tmpdir(), 'yoke-help-'))
  mkdirSync(join(dir, '.yoke'))
  writeFileSync(join(dir, '.yoke', 'config.yaml'), 'canonVersion: 1.22.0\nagents: [codex]\nloop:\n  enabled: true\n')
  writeFileSync(join(dir, 'user.txt'), 'preserve me')
})
afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }) })

describe('read-only CLI discovery', () => {
  it.each(['setup', 'retrofit'])('%s help never dispatches a mutating operation', async cmd => {
    const before = snapshot(dir)
    for (const flag of ['--help', '-h']) {
      expect(await main([cmd, dir, flag])).toBe(0)
      expect(snapshot(dir)).toEqual(before)
    }
    expect(runSetup).not.toHaveBeenCalled()
    expect(runRetrofit).not.toHaveBeenCalled()
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('usage: yoke'))
  })
  it.each(['setup', 'retrofit'])('%s rejects unknown flags before mutation', async cmd => {
    expect(await main([cmd, dir, '--typo-flag'])).not.toBe(0)
    expect(runSetup).not.toHaveBeenCalled()
    expect(runRetrofit).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--typo-flag'))
  })
  it('rejects incompatible setup toggles before mutation', async () => {
    expect(await main(['setup', dir, '--loop', '--no-loop'])).not.toBe(0)
    expect(runSetup).not.toHaveBeenCalled()
  })
  it('retains documented setup options', async () => {
    expect(await main(['setup', dir, '--yes', '--host=codex', '--loop'])).toBe(0)
    expect(runSetup).toHaveBeenCalledOnce()
  })
  it.each([['loop', 'on'], ['context', 'init']])('rejects unknown %s flags before writing state', async (cmd, sub) => {
    const before = snapshot(dir)
    expect(await main([cmd, sub, dir, '--typo-flag'])).not.toBe(0)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--typo-flag'))
    expect(snapshot(dir)).toEqual(before)
  })
  it('recognizes the existing worktree recovery flag before validating other options', async () => {
    expect(await main(['loop', 'run', dir, '--resume-worktree', '--max=0'])).not.toBe(0)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid --max'))
  })
  it.each([
    ['loop', 'run', '--isolate', '--no-isolate', '--max=0'],
    ['goal', 'run', '--native-goal', '--no-native-goal', '--runner=invalid'],
  ])('rejects contradictory %s execution policies before dispatch', async (...args) => {
    expect(await main(args)).not.toBe(0)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Cannot use'))
  })
})
