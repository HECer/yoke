import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../src/cli.js'
import { runToolPreflight } from '../src/code-intelligence/preflight.js'
vi.mock('../src/code-intelligence/preflight.js', () => ({ runToolPreflight: vi.fn(async () => ({ rtk: { status: 'degraded' }, codeIntelligence: { status: 'off', workspaceId: 'test' } })) }))

afterEach(() => vi.restoreAllMocks())
it('reads local usage without mutations or a model invocation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-cli-usage-'))
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    expect(await main(['usage', root, '--json', '--from=2026-10-01', '--to=2026-10-05'])).toBe(0)
    const report = JSON.parse(String(log.mock.calls[0][0]))
    expect(report.total.inputTokens).toBeNull()
    expect(report.hostCoverage.guardian).toBe('unknown')
    expect(readdirSync(root)).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
it('rejects invalid usage time ranges', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await main(['usage', '--from=not-a-date'])).not.toBe(0)
  expect(error).toHaveBeenCalledWith(expect.stringContaining('time range'))
})
it('exposes read-only operational preflight as JSON', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  expect(await main(['tools-preflight', '.', '--json'])).toBe(0)
  expect(runToolPreflight).toHaveBeenCalledWith('.')
  expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ rtk: { status: 'degraded' }, codeIntelligence: { status: 'off' } })
})
