import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { register } from 'tsx/esm/api'

// Match the bounded, one-run fixture used for the November audit measurement.
const BASELINE_COMMIT = 'a97c5e09aee68c00acede09c92753f56ac754ecb'
const ANALYTICS = 'src/dashboard/analytics.ts'
const CURRENT_HELPERS = ['src/dashboard/contracts.ts', 'src/observability/history.ts', 'src/observability/events.ts', 'src/observability/failure.ts']
const EVENT_COUNTS = [2000, 8000, 16000, 32000]
const SAMPLES = 3
const repo = fileURLToPath(new URL('../', import.meta.url))
const hash = value => createHash('sha256').update(value).digest('hex')
const hashFile = path => hash(readFileSync(join(repo, path)))
const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024, timeout: 10000 })

async function main(args) {
  if (args.length > 1 || args.some(arg => !arg.startsWith('--out=') || arg.length === '--out='.length)) throw Error('Usage: node bench/dashboard-remediation.mjs [--out=<new-result.json>]')
  let baselineSource
  try { baselineSource = git(['show', `${BASELINE_COMMIT}:${ANALYTICS}`]) }
  catch { throw Error(`This benchmark needs a source checkout containing commit ${BASELINE_COMMIT}; it does not fetch or install the old revision`) }
  const currentHead = git(['rev-parse', 'HEAD']).trim()
  const currentSources = Object.fromEntries([ANALYTICS, ...CURRENT_HELPERS].map(path => [path, hashFile(path)]))
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'yoke-dashboard-remediation-'))
  const loader = register({ namespace: 'yoke-dashboard-remediation', tsconfig: false })
  try {
    const analyticsUrl = pathToFileURL(join(repo, ANALYTICS))
    // Only the pinned analytics module is historical. Both arms intentionally
    // use the checkout's current helper code, as in the original audit.
    const rewritten = baselineSource.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/gu, (_match, _quote, specifier) => {
      return `from ${JSON.stringify(new URL(specifier.replace(/\.js$/u, '.ts'), analyticsUrl).href)}`
    })
    const baselinePath = join(fixtureRoot, 'analytics-before.mts')
    writeFileSync(baselinePath, rewritten)
    const before = await loader.import(pathToFileURL(baselinePath).href, import.meta.url)
    const after = await loader.import(analyticsUrl.href, import.meta.url)
    const history = join(fixtureRoot, '.yoke', 'history', '2026-11-01')
    mkdirSync(history, { recursive: true })
    const shard = join(history, 'a'.repeat(32) + '.jsonl')
    const from = Date.parse('2026-11-01T00:00:00Z')
    const period = { from, to: from + 86400000, bucket: 'day' }
    const results = []
    for (const events of EVENT_COUNTS) {
      const content = Array.from({ length: events }, (_, index) => JSON.stringify({
        schemaVersion: 1, id: String(index).padStart(36, '0'), runId: 'one-run',
        timestamp: new Date(from + index).toISOString(), type: 'phase-ended', phase: 'verification', durationMs: 1,
      })).join('\n') + '\n'
      writeFileSync(shard, content)
      const row = { events, inputBytes: Buffer.byteLength(content), inputSha256: hash(content) }
      const outputs = {}
      for (const [label, implementation] of [['before', before], ['after', after]]) {
        const samplesMs = []
        for (let sample = 0; sample < SAMPLES; sample++) {
          const start = performance.now()
          outputs[label] = implementation.projectAnalytics(fixtureRoot, period)
          samplesMs.push(performance.now() - start)
        }
        assert.deepEqual(outputs[label].errors, [], `${label}: incomplete fixture history`)
        assert.equal(outputs[label].runs.length, 1, `${label}: expected one complete run`)
        assert.equal(outputs[label].total.activity, events, `${label}: lost events`)
        row[label] = { samplesMs, medianMs: [...samplesMs].sort((a, b) => a - b)[1], serializedBytes: Buffer.byteLength(JSON.stringify(outputs[label])) }
      }
      assert.deepEqual(outputs.before.total, outputs.after.total, 'project totals changed')
      assert.deepEqual(outputs.before.runs[0].total, outputs.after.runs[0].total, 'run totals changed')
      assert.equal(outputs.before.runs[0].events.length, events)
      assert.equal(outputs.after.runs[0].eventCount, events)
      results.push({ ...row, totalsEqual: true, eventsAccounted: events })
    }
    for (const [path, expected] of Object.entries(currentSources)) assert.equal(hashFile(path), expected, `Source changed during measurement: ${path}`)
    const report = {
      schemaVersion: 1, kind: 'synthetic-dashboard-remediation', measuredAt: new Date().toISOString(),
      baselineCommit: BASELINE_COMMIT, currentHead, current: 'working-tree analytics with current shared helpers in both arms',
      runtime: process.version, platform: process.platform, architecture: process.arch,
      samplesPerPoint: SAMPLES, order: 'before samples then after samples at each ascending event count',
      fixture: 'one synthetic run in one JSONL shard; phase-ended verification events with 1 ms durations',
      period: { from: new Date(period.from).toISOString(), to: new Date(period.to).toISOString(), bucket: period.bucket },
      hashes: { algorithm: 'sha256', baselineAnalytics: hash(baselineSource), currentSources,
        benchmark: hash(readFileSync(fileURLToPath(import.meta.url))), packageLock: hashFile('package-lock.json') },
      totalsComparedWithDeepStrictEqual: true,
      limits: [
        'Only analytics.ts comes from the pinned baseline; current helper implementations and installed dependencies are shared by both arms.',
        'Timing includes projectAnalytics file reads, parsing and aggregation; it excludes fixture generation, source loading and JSON serialization.',
        'Serialized bytes measure the full response object separately. This does not time HTTP delivery, browser rendering, or interactions.',
        'Three same-process samples in fixed order are local observations, without process isolation, cache flushing, counterbalancing or a statistical confidence claim.',
        'This one-run synthetic distribution does not measure multi-project behavior, provider calls, billed tokens, monetary savings, or whole-task speed.',
      ], results,
    }
    const encoded = JSON.stringify(report, null, 2) + '\n'
    if (args.length) {
      const output = resolve(args[0].slice('--out='.length))
      mkdirSync(dirname(output), { recursive: true })
      writeFileSync(output, encoded, { flag: 'wx' })
    }
    process.stdout.write(encoded)
  } finally {
    await loader.unregister()
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
