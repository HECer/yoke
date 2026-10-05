import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
const exec = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execSync: exec }))
import { commandVerifier } from '../../src/loop/verify.js'
const roots: string[] = []
afterEach(() => { exec.mockClear(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
it('executes the unchanged proof command with absolute cwd and a cloned child environment', () => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-verify-env-')); roots.push(root)
  const original = { ...process.env }
  expect(commandVerifier('original proof command')(relative(process.cwd(), root)).passed).toBe(true)
  const [command, options] = exec.mock.calls[0]
  expect(command).toBe('original proof command')
  expect(options.cwd).toBe(root)
  expect(options.env).not.toBe(process.env)
  expect(process.env).toEqual(original)
})
