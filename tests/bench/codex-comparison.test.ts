import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function analyze(...sources: unknown[]) {
  const root = mkdtempSync(join(tmpdir(), 'yoke-comparison-summary-'))
  roots.push(root)
  const paths = sources.map((source, index) => {
    const path = join(root, 'results-' + index + '.json')
    writeFileSync(path, JSON.stringify(source))
    return path
  })
  return spawnSync(process.execPath, [resolve('bench/analyze-codex-comparison.mjs'), ...paths], { encoding: 'utf8' })
}
function context() {
  return {
    source: { version: '1.22.0', commit: 'f'.repeat(40), dirty: false, buildDigest: 'b'.repeat(64), stable: true },
    fixture: { id: 'small', seedDigest: 'a'.repeat(64), acceptanceDigest: 'c'.repeat(64), requirementsDigest: 'd'.repeat(64) },
    execution: {
      provider: 'codex', requestedModel: 'fixed-alias', actualModels: ['reported-model'],
      effort: 'low', routing: false, nativeMultiAgent: false, nativeGoal: false, parallel: 1,
      workflow: 'fixed-workflow', promptDigest: 'e'.repeat(64), promptScope: 'provider-prompt',
    },
    startup: {
      permissionProfile: 'unsafe', bare: true, ignoreRules: false, commitPolicy: 'same',
      isolation: 'fresh', timeoutPolicy: '600000ms', userStatePolicy: 'isolated',
    },
    environment: {
      platform: 'test-platform', arch: 'test-arch', nodeVersion: 'v24.0.0',
      providerVersion: 'recorded-cli-version', hostDigest: 'f'.repeat(64),
      hostLoad: 'uncontrolled', skillsPlugins: 'not-audited',
    },
  }
}
function run(arm = 'codex', repeat = 1, wallMs = 100) {
  return {
    fixture: 'small', arm, repeat, model: 'fixed-alias', effort: 'low', routing: false,
    accepted: true, wallMs, acceptanceMs: 10, context: context(),
    usage: { inputTokens: 100, cachedInputTokens: 60, outputTokens: 5 },
    dir: 'private-machine-path',
  }
}
function source(rows = [run(), run('yoke-serial')], repeats = 1) {
  return {
    schemaVersion: 2, version: '1.22.0',
    manifest: {
      schemaVersion: 1, id: 'controlled-fixture-comparison', kind: 'controlled',
      arms: ['codex', 'yoke-serial'], repeats,
      allowedDifferences: [] as { field: string; reason: string }[],
    },
    results: rows, limits: [] as string[],
  }
}
function summary(input: unknown) {
  const result = analyze(input)
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout)
}

it('reports a fair 1.22.0 paired comparison with measured provenance and even medians', () => {
  const result = summary(source([run('codex', 1, 100), run('yoke-serial', 1, 130), run('codex', 2, 200), run('yoke-serial', 2, 150)], 2))
  expect(result).toMatchObject({ auditedVersion: '1.22.0', auditedCommit: 'f'.repeat(40), reportedModels: ['reported-model'] })
  expect(result.comparisons[0].status).toBe('verified')
  expect(result.groups[0]).toMatchObject({ arm: 'codex', runs: 2, accepted: 2, medianWallMs: 150, medianElapsedToAcceptanceMs: 160, medianFreshInputTokens: 40, medianAllInputTokens: 100, medianOutputTokens: 5 })
  expect(JSON.stringify(result)).not.toContain('private-machine-path')
})

it('blocks the audit counterexample: different models across arms cannot enter a comparison group', () => {
  const input = source()
  input.results[1].context.execution.requestedModel = 'different-alias'
  input.results[1].context.execution.actualModels = ['different-reported-model']
  const result = summary(input)
  expect(result.groups).toEqual([])
  expect(result.auditedVersion).toBeNull()
  expect(result.comparisons[0]).toMatchObject({ status: 'incompatible', provenance: [expect.objectContaining({ version: '1.22.0' })] })
  expect(result.comparisons[0].reasons).toContain('Undeclared difference between arms: execution.requestedModel')
})

it.each(['requestedModel', 'actualModels', 'effort', 'routing', 'nativeMultiAgent'] as const)('checks %s across arms', field => {
  const input = source()
  const execution = input.results[1].context.execution
  if (field === 'actualModels') execution.actualModels = ['changed-model']
  else if (field === 'routing' || field === 'nativeMultiAgent') execution[field] = true
  else execution[field] = 'changed'
  expect(summary(input).comparisons[0].status).toBe('incompatible')
})

it('requires declared workflow/startup differences and preserves their rationale', () => {
  const input = source()
  input.results[1].context.execution.workflow = 'yoke-story-loop'
  input.results[1].context.startup.ignoreRules = true
  expect(summary(input).groups).toEqual([])
  input.manifest.allowedDifferences = [
    { field: 'execution.workflow', reason: 'Compare complete workflows' },
    { field: 'startup.ignoreRules', reason: 'Explicitly compare the historical startup policy' },
  ]
  const result = summary(input)
  expect(result.comparisons[0].status).toBe('verified')
  expect(result.comparisons[0].manifest.allowedDifferences).toEqual(input.manifest.allowedDifferences)
  expect(result.groups).toHaveLength(2)
})

it('allows an intentional model comparison only when requested and reported identities are declared variables', () => {
  const input = source()
  input.results[1].context.execution.requestedModel = 'different-alias'
  input.results[1].context.execution.actualModels = ['different-reported-model']
  input.manifest.allowedDifferences = [
    { field: 'execution.requestedModel', reason: 'Declared model comparison' },
    { field: 'execution.actualModels', reason: 'Declared model comparison' },
  ]
  expect(summary(input).comparisons[0].status).toBe('verified')
})

it.each(['seedDigest', 'acceptanceDigest', 'requirementsDigest'] as const)('never combines different fixture %s', field => {
  const input = source()
  input.results[1].context.fixture[field] = '9'.repeat(64)
  expect(summary(input).comparisons[0].status).toBe('incompatible')
  input.manifest.allowedDifferences = [{ field: 'fixture.' + field, reason: 'Cannot waive acceptance equivalence' }]
  expect(summary(input).groups).toEqual([])
})

it('requires a dirty-build digest and stable source before declaring provenance verified', () => {
  const input = source()
  input.results.forEach(row => { row.context.source.dirty = true })
  input.results[1].context.source.buildDigest = ''
  expect(summary(input).comparisons[0].status).toBe('unverified')
  input.results[1].context.source.buildDigest = 'b'.repeat(64)
  expect(summary(input).comparisons[0].status).toBe('verified')
  input.results[1].context.source.stable = false
  expect(summary(input).groups).toEqual([])
})

it('missing reported identity is unverified even with the same requested alias', () => {
  const input = source()
  input.results[1].context.execution.actualModels = []
  const result = summary(input)
  expect(result.groups).toEqual([])
  expect(result.comparisons[0].status).toBe('unverified')
})

it('keeps missing token telemetry unknown without manufacturing an efficiency group', () => {
  const input = source()
  const result = summary({ ...input, results: input.results.map(row => ({ ...row, usage: null })) })
  expect(result.groups).toEqual([])
  expect(result.comparisons[0].status).toBe('unverified')
  expect(result.comparisons[0].diagnosticSummaries[0]).toMatchObject({ medianFreshInputTokens: null, medianAllInputTokens: null, medianOutputTokens: null })
})

it('reads old result files and historical aggregate reports as legacy/unverified', () => {
  const historical = JSON.parse(readFileSync(resolve('bench/results/codex-comparison-2026-09-29.json'), 'utf8'))
  const old = { version: '1.21.1', results: [run(), { ...run('yoke-serial'), model: 'different-model' }], limits: [] }
  const output = analyze(historical, old)
  expect(output.status).toBe(0)
  const result = JSON.parse(output.stdout)
  expect(result.groups).toEqual([])
  expect(result.legacyReports).toEqual([
    expect.objectContaining({ status: 'legacy/unverified', reportedVersion: '1.19.0' }),
    expect.objectContaining({ status: 'legacy/unverified', reportedVersion: '1.21.1' }),
  ])
  expect(result.auditedVersion).toBeNull()
  expect(result.runs.every((row: { evidenceStatus: string }) => row.evidenceStatus === 'legacy/unverified')).toBe(true)
})

it('does not merge separate experiments just because fixture and arm names match', () => {
  const first = source()
  const second = source()
  second.manifest.id = 'separate-experiment'
  second.results.forEach(row => { row.context.execution.requestedModel = 'other'; row.context.execution.actualModels = ['other-reported'] })
  const output = analyze(first, second)
  expect(output.status).toBe(0)
  const result = JSON.parse(output.stdout)
  expect(result.comparisons).toHaveLength(2)
  expect(result.groups).toHaveLength(4)
})

it('rejects conflicting manifests with the same identity and duplicate arm/repeat rows', () => {
  const first = source()
  const second = source()
  second.manifest.allowedDifferences = [{ field: 'execution.effort', reason: 'Changed policy' }]
  const result = JSON.parse(analyze(first, second).stdout)
  expect(result.comparisons[0].status).toBe('incompatible')
  expect(result.groups).toEqual([])
  expect(summary(source([run(), run()])).comparisons[0].status).toBe('incompatible')
})

it('requires all planned pairs and does not present a failed fast arm as a speedup', () => {
  expect(summary(source([run()])).comparisons[0].status).toBe('incomplete')
  const input = source()
  input.results[1].accepted = false
  input.results[1].wallMs = 1
  const result = summary(input)
  expect(result.groups).toEqual([])
  expect(result.comparisons[0].status).toBe('acceptance-failed')
  expect(result.comparisons[0].diagnosticSummaries[1]).toMatchObject({ accepted: 0, medianWallMs: 1 })
})

it('does not ignore unknown context fields or changes within repeated arms', () => {
  const input = source()
  const unknown = { ...input, results: input.results.map(row => ({ ...row, context: { ...row.context, startup: { ...row.context.startup, futurePolicy: true } } })) }
  expect(summary(unknown).comparisons[0].status).toBe('unverified')
  const repeated = source([run('codex', 1), run('yoke-serial', 1), run('codex', 2), run('yoke-serial', 2)], 2)
  repeated.results[2].context.execution.effort = 'high'
  repeated.manifest.allowedDifferences = [{ field: 'execution.effort', reason: 'Between arms only' }]
  expect(summary(repeated).comparisons[0].status).toBe('incompatible')
})

it('rejects impossible cache accounting, invalid timing and empty samples', () => {
  const input = source()
  input.results[0].usage.cachedInputTokens = 101
  expect(analyze(input).status).not.toBe(0)
  expect(analyze(source([run('codex', 1, 0)])).status).not.toBe(0)
  expect(analyze(source([])).status).not.toBe(0)
})
