import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startProviderProcess } from '../../src/agents/providers.js'
import { killProcessTree } from '../../src/loop/watchdog.js'

const tempDirs: string[] = []

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yoke-provider-record-failure-'))
  mkdirSync(join(dir, '.yoke'), { recursive: true })
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('provider process ownership publication', () => {
  it('closes stdin and escalates forced termination when record publication cannot confirm the first stop', async () => {
    const dir = tempProject()
    const inputPath = join(dir, 'unexpected-input.txt')
    const stdinClosedPath = join(dir, 'stdin-closed.txt')
    const terminations: Array<readonly [number, boolean]> = []
    const handle = startProviderProcess('codex', {
      command: process.execPath,
      args: ['--eval', `const { writeFileSync } = require('node:fs'); process.stdin.on('data', data => writeFileSync(${JSON.stringify(inputPath)}, data)); process.stdin.on('end', () => writeFileSync(${JSON.stringify(stdinClosedPath)}, 'closed')); setInterval(() => {}, 1_000)`],
      input: 'must never reach the provider',
      cwd: dir,
    }, {
      terminationGraceMs: 50,
      recordAdapter: { publish: () => { throw new Error('record volume unavailable') }, remove: () => undefined },
      terminateProcessTree: (pid, force) => {
        terminations.push([pid, force])
        if (!force) return false
        killProcessTree(pid, true)
        return true
      },
    })

    const result = await handle.completion

    expect(result).toMatchObject({ kind: 'spawn-failed', error: expect.stringContaining('process ownership record failure') })
    const pid = handle.pid
    if (typeof pid !== 'number') throw new Error('expected spawned provider PID')
    expect(terminations).toEqual([[pid, false], [pid, true]])
    expect(existsSync(inputPath)).toBe(false)
    expect(existsSync(stdinClosedPath)).toBe(true)
    expect(existsSync(handle.recordPath)).toBe(false)
  }, 15_000)
})
