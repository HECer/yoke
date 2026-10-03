// node bench/analyze-codex-comparison.mjs <results.json> ... > summary.json
import { readFileSync } from 'node:fs'
import { assessComparison, stableComparisonJson } from './result-schema.mjs'

const sources = process.argv.slice(2).map(path => JSON.parse(readFileSync(path, 'utf8')))
if (!sources.length) throw new Error('Supply comparison results.json files')
const runs = []
const cohorts = new Map()
const legacyReports = []
const median = values => {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  return n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2 : null
}
const measured = value => Number.isFinite(value) && value >= 0
const metric = (rows, read) => rows.every(row => measured(read(row))) ? median(rows.map(read)) : null
function summarize(rows) {
  return {
    fixture: rows[0].fixture, arm: rows[0].arm, runs: rows.length,
    accepted: rows.filter(row => row.accepted === true).length,
    medianWallMs: median(rows.map(row => row.wallMs)),
    medianElapsedToAcceptanceMs: metric(rows, row => measured(row.acceptanceMs) ? row.wallMs + row.acceptanceMs : null),
    medianFreshInputTokens: metric(rows, row => row.usage?.measurementComplete === false ? null : row.freshInputTokens),
    medianOutputTokens: metric(rows, row => row.usage?.measurementComplete === false ? null : row.usage?.outputTokens),
    medianAllInputTokens: metric(rows, row => row.usage?.measurementComplete === false ? null : row.usage?.inputTokens),
  }
}
function armSummaries(rows) {
  return [...new Set(rows.map(row => row.arm))].map(arm => summarize(rows.filter(row => row.arm === arm)))
}
for (const [index, source] of sources.entries()) {
  const input = source.results ?? source.runs
  if (!Array.isArray(input) || !input.length) throw new Error('No completed runs in input ' + (index + 1))
  const rows = input.map(({ dir, ...row }) => {
    if (!measured(row.wallMs) || row.wallMs <= 0) throw new Error('Invalid measurement: wall time')
    for (const field of ['inputTokens', 'cachedInputTokens', 'outputTokens']) {
      if (row.usage?.[field] != null && !measured(row.usage[field])) throw new Error('Invalid measurement: ' + field)
    }
    if (row.acceptanceMs != null && !measured(row.acceptanceMs)) throw new Error('Invalid measurement: acceptance time')
    const freshInputTokens = measured(row.usage?.inputTokens) && measured(row.usage?.cachedInputTokens)
      ? row.usage.inputTokens - row.usage.cachedInputTokens : null
    if (freshInputTokens !== null && freshInputTokens < 0) throw new Error('Invalid measurement: cache exceeds input')
    return { ...row, freshInputTokens }
  })
  if (!source.manifest) {
    legacyReports.push({
      status: 'legacy/unverified', reportedVersion: source.version ?? source.auditedVersion ?? null,
      reportedCommit: source.commit ?? source.auditedCommit ?? null, runs: rows.length,
      reason: 'No versioned manifest; provenance and cross-arm conditions cannot be verified',
      diagnosticSummaries: armSummaries(rows),
    })
    runs.push(...rows.map(row => ({ ...row, evidenceStatus: 'legacy/unverified' })))
    continue
  }
  // A malformed identity remains its own unverified cohort, never joins another file.
  const id = typeof source.manifest.id === 'string' && source.manifest.id ? source.manifest.id : 'invalid-input-' + index
  const cohort = cohorts.get(id) ?? { id, manifests: [], runs: [] }
  cohort.manifests.push(source.manifest)
  cohort.runs.push(...rows)
  cohorts.set(id, cohort)
}
const comparisons = [...cohorts.values()].map(cohort => ({
  id: cohort.id,
  ...assessComparison(cohort.manifests, cohort.runs),
  manifest: cohort.manifests[0],
  provenance: [...new Map(cohort.runs.map(row => [stableComparisonJson(row.context?.source), row.context?.source ?? null])).values()],
  diagnosticSummaries: armSummaries(cohort.runs),
}))
const groups = []
for (const comparison of comparisons) {
  const rows = cohorts.get(comparison.id).runs
  runs.push(...rows.map(row => ({ ...row, comparisonId: comparison.id, evidenceStatus: comparison.status })))
  if (comparison.status === 'verified') {
    groups.push(...armSummaries(rows).map(group => ({ comparisonId: comparison.id, ...group })))
  }
}
const verifiedSources = comparisons.filter(comparison => comparison.status === 'verified').flatMap(comparison => comparison.provenance)
const unique = values => [...new Set(values)]
const versions = unique(verifiedSources.map(source => source.version))
const commits = unique(verifiedSources.map(source => source.commit))
console.log(JSON.stringify({
  schemaVersion: 2,
  auditedVersion: versions.length === 1 ? versions[0] : null,
  auditedCommit: commits.length === 1 ? commits[0] : null,
  requestedModels: unique(runs.map(row => row.context?.execution?.requestedModel ?? row.model).filter(Boolean)),
  reportedModels: unique(runs.flatMap(row => row.context?.execution?.actualModels ?? [])),
  comparisons, groups, legacyReports, runs,
  limitations: unique([
    ...sources.flatMap(source => source.limits ?? source.limitations ?? []),
    'Verified means the recorded manifest conditions match; it does not certify model behavior, host isolation, or statistical significance',
    'Diagnostic summaries include unsuccessful or unverified runs and must not be used as accepted performance comparisons',
    'Missing or partial token telemetry remains unknown; no USD price is inferred',
  ]),
  pricesMeasured: false, cpuMeasured: false, memoryMeasured: false,
}, null, 2))
