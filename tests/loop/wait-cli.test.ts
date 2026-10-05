import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../../src/cli.js'
let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'yoke-wait-cli-')); mkdirSync(join(root, '.yoke')); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }) })
it('exposes a terminal JSON handoff without a model invocation', async () => {
  writeFileSync(join(root, '.yoke/loop-status.json'), JSON.stringify({ state: 'complete', iteration: 1, progress: { passed: 2, total: 2 } }))
  expect(await main(['loop', 'wait', root, '--json', '--timeout=1'])).toBe(0)
  expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0][0]))).toMatchObject({ outcome: 'changed', status: { state: 'complete' } })
})
it('makes timeout distinguishable from completion in the CLI', async () => {
  expect(await main(['loop', 'wait', root, '--json', '--timeout=0.01'])).toBe(3)
  expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0][0]))).toMatchObject({ outcome: 'timeout', status: null })
})
it('rejects invalid wait options without starting a provider', async () => {
  expect(await main(['loop', 'wait', root, '--until=invalid'])).toBe(1)
  expect(await main(['loop', 'wait', root, '--since=invalid'])).toBe(1)
})
