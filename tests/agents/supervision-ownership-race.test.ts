import { afterEach, expect, it, vi } from 'vitest'
import { lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertPreviousProvidersStopped, readSupervision } from '../../src/agents/supervision.js'

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, lstatSync: vi.fn(actual.lstatSync) }
})

const dirs: string[] = []
afterEach(() => {
  vi.mocked(lstatSync).mockReset()
  dirs.splice(0).forEach(path => rmSync(path, { recursive: true, force: true }))
})

it.each(['provider-processes', 'supervision', 'worktrees'])('keeps scanning %s after an unrelated listed record disappears', async directory => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  vi.mocked(lstatSync).mockImplementation(actual.lstatSync)
  const cwd = mkdtempSync(join(tmpdir(), 'yoke ownership race ')); dirs.push(cwd)
  const target = directory === 'worktrees' ? join(cwd, '.yoke', 'worktrees', 'z') : cwd
  const supervision = join(target, '.yoke', 'supervision'), ownership = join(target, '.yoke', 'provider-processes')
  mkdirSync(supervision, { recursive: true }); mkdirSync(ownership, { recursive: true })
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore', windowsHide: true })
  await new Promise<void>((resolve, reject) => { child.once('close', () => resolve()); child.once('error', reject) })
  writeFileSync(join(supervision, 'z.json'), JSON.stringify({ id: 'prior', state: 'termination-unconfirmed', childPid: child.pid, startedAt: '2026-01-01', heartbeatAt: '2026-01-01' }))
  writeFileSync(join(ownership, 'z.json'), JSON.stringify({ version: 1, owner: 'provider-process', targetDir: target, childPid: child.pid, startedAt: 'unverified:fixture' }))
  expect(readSupervision(cwd, '')[0].liveness).toBe('exited')
  const disappeared = join(cwd, '.yoke', directory, 'a.json')
  if (directory === 'worktrees') mkdirSync(disappeared)
  else writeFileSync(disappeared, '{}')
  let intercepted = false
  vi.mocked(lstatSync).mockImplementation(((...args: Parameters<typeof lstatSync>) => {
    if (String(args[0]) === disappeared) {
      intercepted = true
      rmSync(disappeared, { recursive: true })
      throw Object.assign(Error('removed during scan'), { code: 'ENOENT' })
    }
    return actual.lstatSync(...args)
  }) as typeof lstatSync)
  expect(() => assertPreviousProvidersStopped(cwd)).toThrow('unconfirmed')
  expect(intercepted).toBe(true)
})
