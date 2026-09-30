import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function analyze(results: unknown[]) {
  const root = mkdtempSync(join(tmpdir(), 'yoke-comparison-summary-')); roots.push(root)
  const input = join(root, 'results.json'); writeFileSync(input, JSON.stringify({ results, limits: [] }))
  return spawnSync(process.execPath, [resolve('bench/analyze-codex-comparison.mjs'), input], { encoding: 'utf8' })
}
const run = (wallMs: number, usage: unknown = { inputTokens: 100, cachedInputTokens: 60, outputTokens: 5 }) => ({ fixture: 'small', arm: 'codex', model: 'fixed-model', effort: 'low', routing: false, accepted: true, wallMs, usage, dir: 'private-machine-path' })
it('reports even-sample medians and separates fresh from cached input', () => {
  const output = analyze([run(100), run(200)])
  expect(output.status).toBe(0)
  const summary = JSON.parse(output.stdout)
  expect(summary.groups[0]).toMatchObject({ runs: 2, accepted: 2, medianWallMs: 150, medianFreshInputTokens: 40, medianAllInputTokens: 100, medianOutputTokens: 5 })
  expect(output.stdout).not.toContain('private-machine-path')
})
it('retains unknown usage instead of treating it as zero', () => {
  const output = analyze([run(100, null)])
  expect(output.status).toBe(0)
  expect(JSON.parse(output.stdout).groups[0]).toMatchObject({ medianFreshInputTokens: null, medianAllInputTokens: null, medianOutputTokens: null })
})
it('rejects impossible cache accounting', () => {
  expect(analyze([run(100, { inputTokens: 10, cachedInputTokens: 20, outputTokens: 1 })]).status).not.toBe(0)
})
it('rejects mixed model policies in one group', () => {
  expect(analyze([run(100), { ...run(200), model: 'different-model' }]).status).not.toBe(0)
})
it('rejects invalid timing and empty samples', () => {
  expect(analyze([run(0)]).status).not.toBe(0)
  expect(analyze([]).status).not.toBe(0)
})
