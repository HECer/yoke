#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateResult } from './result-schema.mjs'

const benchDir = dirname(fileURLToPath(import.meta.url))
if (process.argv.includes('--help')) {
  console.log('usage: node bench/run-matrix.mjs [--label=sample]')
  process.exit(0)
}
const label = process.argv.find(arg => arg.startsWith('--label='))?.slice(8) ?? `matrix-${new Date().toISOString()}`
mkdirSync(join(benchDir, 'results'), { recursive: true })
for (const runner of ['claude', 'codex', 'gemini']) {
  const probe = spawnSync(runner, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32', timeout: 20_000 })
  if (probe.status !== 0) {
    const row = validateResult({ schemaVersion: 1, fixtureVersion: 'string-kit@1', runner, sampleLabel: label, permissionProfile: 'safe', usageAvailable: false, modelAvailable: false, verdict: 'unavailable', blocker: (probe.stderr || probe.error?.message || 'CLI unavailable').trim(), conflicts: 0, wallClockMs: null, iterations: 0, finalTestsPass: false })
    const out = join(benchDir, 'results', `${runner}-unavailable-${Date.now()}.json`)
    writeFileSync(out, JSON.stringify(row, null, 2) + '\n')
    console.log(JSON.stringify(row))
    continue
  }
  const run = spawnSync(process.execPath, [join(benchDir, 'run.mjs'), `--runner=${runner}`, `--label=${label}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  if (run.stdout) process.stdout.write(run.stdout)
}
