import { expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startProviderProcess } from '../../src/agents/process.js'
import { readSupervision } from '../../src/agents/supervision.js'

vi.mock('../../src/agents/process-incarnation.js', () => ({ processIncarnation: () => undefined }))

it.skipIf(process.platform === 'win32')('stops descendants when process identity is unavailable and retains any unconfirmed group ownership', async () => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-owned-group-'))
  const heartbeat = join(root, 'heartbeat')
  const descendant = `const fs=require('node:fs');let n=0;const timer=setInterval(()=>fs.writeFileSync(${JSON.stringify(heartbeat)},String(++n)),10);setTimeout(()=>{clearInterval(timer)},3000)`
  const leader = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});setInterval(()=>{},1000)`
  const handle = startProviderProcess('codex', { command: process.execPath, args: ['-e', leader], input: '', cwd: root }, { terminationGraceMs: 100 })
  try {
    await expect.poll(() => existsSync(heartbeat) && Number(readFileSync(heartbeat, 'utf8')) > 1).toBe(true)
    expect(handle.cancel('test cancellation')).toBe(true)
    await expect(handle.completion).resolves.toMatchObject({ kind: 'cancelled' })
    const atCompletion = readFileSync(heartbeat, 'utf8')
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(readFileSync(heartbeat, 'utf8')).toBe(atCompletion)
    let groupPresent = true
    try { process.kill(-handle.pid!, 0) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') groupPresent = false }
    if (groupPresent) expect(existsSync(handle.recordPath)).toBe(true)
    expect(readSupervision(root, '')[0].state).toBe(existsSync(handle.recordPath) ? 'termination-unconfirmed' : 'stopped')
  } finally {
    handle.cancel('test cleanup')
    // The fixture's descendants have a short lifetime even if this assertion fails.
    if (handle.pid) { try { process.kill(-handle.pid, 'SIGKILL') } catch { /* fixture group already exited */ } }
    await handle.completion
    rmSync(root, { recursive: true, force: true })
  }
}, 10_000)
