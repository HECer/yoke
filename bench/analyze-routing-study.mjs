#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const resultsDir = join(dirname(fileURLToPath(import.meta.url)), 'results')
const rows = readdirSync(resultsDir)
  .filter(file => file.startsWith('yoke-codex-study-codex-routing-') && file.endsWith('.json'))
  .map(file => ({ file, ...JSON.parse(readFileSync(join(resultsDir, file), 'utf8')) }))
  .filter(row => /^codex-only-pair[1-3]-(on|off)$/.test(row.sampleLabel))

const median = values => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
const pct = (from, to) => ((to - from) / from) * 100
const metric = (group, read) => {
  const values = group.map(read)
  return { values, min: Math.min(...values), median: median(values), max: Math.max(...values) }
}

if (rows.length !== 6) throw new Error(`expected six codex-only study rows, found ${rows.length}`)
for (const row of rows) {
  if (row.verdict !== 'completed' || !row.finalTestsPass || row.iterations !== 2) throw new Error(`invalid study row: ${row.file}`)
  if (row.finalVerification?.originalAcceptanceTestsExitCode !== 0 || row.finalVerification?.originalAcceptanceTestCount !== 6) {
    throw new Error(`hidden acceptance replay failed: ${row.file}`)
  }
}

const groups = Object.fromEntries(['off', 'on'].map(routing => {
  const group = rows.filter(row => row.routing === routing).sort((a, b) => a.sampleLabel.localeCompare(b.sampleLabel))
  return [routing, {
    runs: group.map(row => row.file),
    wallClockMs: metric(group, row => row.wallClockMs),
    inputTokens: metric(group, row => row.tokenBreakdown.inputTokens),
    cachedInputTokens: metric(group, row => row.tokenBreakdown.cachedInputTokens),
    freshInputTokens: metric(group, row => row.tokenBreakdown.freshInputTokens),
    outputTokens: metric(group, row => row.tokenBreakdown.outputTokens),
    reasoningOutputTokens: metric(group, row => row.tokenBreakdown.reasoningOutputTokens),
  }]
}))

const routed = rows.filter(row => row.routing === 'on')
const controllerCalls = routed.flatMap(row => row.modelCalls.filter(call => call.role === 'orchestrator'))
const workerCalls = routed.flatMap(row => row.modelCalls.filter(call => call.role === 'worker'))
if (workerCalls.length !== 6 || workerCalls.some(call => call.profile !== 'codex-luna' || call.requestedModel !== 'gpt-5.6-luna')) {
  throw new Error('not every routed story executed on codex-luna')
}

const deltas = {}
for (const key of ['wallClockMs', 'inputTokens', 'cachedInputTokens', 'freshInputTokens', 'outputTokens', 'reasoningOutputTokens']) {
  deltas[key] = {
    absolute: groups.on[key].median - groups.off[key].median,
    percent: pct(groups.off[key].median, groups.on[key].median),
  }
}

const pairs = [1, 2, 3].map(pair => {
  const off = rows.find(row => row.sampleLabel === `codex-only-pair${pair}-off`)
  const on = rows.find(row => row.sampleLabel === `codex-only-pair${pair}-on`)
  return {
    pair,
    order: pair === 2 ? ['off', 'on'] : ['on', 'off'],
    wallClockMs: { off: off.wallClockMs, on: on.wallClockMs, percent: pct(off.wallClockMs, on.wallClockMs) },
    freshInputTokens: { off: off.tokenBreakdown.freshInputTokens, on: on.tokenBreakdown.freshInputTokens, percent: pct(off.tokenBreakdown.freshInputTokens, on.tokenBreakdown.freshInputTokens) },
  }
})

console.log(JSON.stringify({
  schemaVersion: 1,
  fixtureVersion: 'yoke-codex-study@1',
  sampleCountPerArm: 3,
  quality: {
    completedRuns: 6,
    completedStories: 12,
    hiddenAcceptancePasses: 36,
    hiddenAcceptanceChecks: 36,
    iterationsPerStory: 1,
  },
  models: {
    parent: { model: 'gpt-5.6-sol', reasoningEffort: 'high' },
    orchestrator: { model: 'gpt-5.6-sol', reasoningEffort: 'low' },
    worker: { model: 'gpt-5.6-luna', reasoningEffort: 'low' },
  },
  groups,
  medianDeltas: deltas,
  pairs,
  controller: {
    calls: controllerCalls.length,
    totalDurationMs: controllerCalls.reduce((sum, call) => sum + call.durationMs, 0),
    totalInputTokens: controllerCalls.reduce((sum, call) => sum + call.inputTokens, 0),
    totalCachedInputTokens: controllerCalls.reduce((sum, call) => sum + (call.cachedInputTokens ?? 0), 0),
    totalFreshInputTokens: controllerCalls.reduce((sum, call) => sum + call.inputTokens - (call.cachedInputTokens ?? 0), 0),
    totalOutputTokens: controllerCalls.reduce((sum, call) => sum + call.outputTokens, 0),
  },
}, null, 2))
