// node bench/analyze-codex-comparison.mjs <results.json> ... > summary.json
import { readFileSync } from 'node:fs'
const sources = process.argv.slice(2).map(path => JSON.parse(readFileSync(path, 'utf8')))
if (!sources.length) throw new Error('Supply comparison results.json files')
const rows = sources.flatMap(s => s.results).map(({ dir, ...row }) => ({
  ...row,
  freshInputTokens: Number.isFinite(row.usage?.inputTokens) && Number.isFinite(row.usage?.cachedInputTokens)
    ? row.usage.inputTokens - row.usage.cachedInputTokens : null,
}))
if (!rows.length) throw new Error('No completed runs')
for (const row of rows) if (!Number.isFinite(row.wallMs) || row.wallMs <= 0 || (row.freshInputTokens !== null && row.freshInputTokens < 0)) throw new Error('Invalid measurement')
const median = values => { const sorted = [...values].sort((a,b) => a-b); const n = sorted.length; return n ? (sorted[Math.floor((n-1)/2)] + sorted[Math.floor(n/2)]) / 2 : null }
const groups = [...new Set(rows.map(r => `${r.fixture}:${r.arm}`))].map(key => {
  const runs = rows.filter(r => `${r.fixture}:${r.arm}` === key)
  if (new Set(runs.map(r => `${r.model}:${r.effort}:${r.routing}`)).size !== 1) throw new Error('Incompatible execution policies in one comparison group')
  return { fixture: runs[0].fixture, arm: runs[0].arm, runs: runs.length, accepted: runs.filter(r => r.accepted).length,
    medianWallMs: median(runs.map(r => r.wallMs)),
    medianFreshInputTokens: runs.every(r => r.freshInputTokens !== null) ? median(runs.map(r => r.freshInputTokens)) : null,
    medianOutputTokens: runs.every(r => Number.isFinite(r.usage?.outputTokens)) ? median(runs.map(r => r.usage.outputTokens)) : null,
    medianAllInputTokens: runs.every(r => Number.isFinite(r.usage?.inputTokens)) ? median(runs.map(r => r.usage.inputTokens)) : null }
})
console.log(JSON.stringify({ auditedVersion: '1.19.0', auditedCommit: '05fac3db1a51412563005e07f80e6e5a9aab8e06', models: [...new Set(rows.map(r => r.model))], effort: 'low', groups, runs: rows, limitations: [...new Set(sources.flatMap(s => s.limits))], pricesMeasured: false, cpuMeasured: false, memoryMeasured: false }, null, 2))
