#!/usr/bin/env node
// Controlled routing A/B against a full repository snapshot kept outside this repo.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { validateResult } from './result-schema.mjs'

const benchDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(benchDir)
const cli = join(repoRoot, 'dist', 'cli.js')
const args = Object.fromEntries(process.argv.slice(2).filter(arg => arg.startsWith('--')).map(arg => {
  const [key, ...value] = arg.slice(2).split('=')
  return [key, value.length ? value.join('=') : true]
}))

const seed = args.seed ? resolve(String(args.seed)) : null
const routing = String(args.routing ?? '')
const runRoot = resolve(String(args['run-root'] ?? join(benchDir, '.runs')))
if (!seed || !existsSync(seed) || !['on', 'off'].includes(routing)) {
  console.error('usage: node bench/run-large.mjs --seed=<dir> --routing=<on|off> [--run-root=<dir>] [--max=4] [--timeout=15] [--label=note]')
  process.exit(2)
}

let acceptanceManifest = null
try { acceptanceManifest = JSON.parse(readFileSync(join(seed, 'bench-acceptance.json'), 'utf8')) } catch { /* legacy large seed */ }
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const fixture = String(acceptanceManifest?.fixture ?? 'yoke-large')
const fixtureVersion = String(acceptanceManifest?.fixtureVersion ?? 'yoke-large@1')
const runDir = join(runRoot, `${fixture}-codex-routing-${routing}-${stamp}`)
mkdirSync(runDir, { recursive: true })
const excluded = new Set(['.git', 'node_modules', 'dist', '.worktrees'])
cpSync(seed, runDir, {
  recursive: true,
  filter: source => source === seed || !excluded.has(basename(source)),
})
symlinkSync(join(repoRoot, 'node_modules'), join(runDir, 'node_modules'), 'junction')

const git = (...gitArgs) => {
  const result = spawnSync('git', ['-C', runDir, ...gitArgs], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${gitArgs.join(' ')} failed: ${result.stderr}`)
}
git('init', '-q')
git('-c', 'user.name=bench', '-c', 'user.email=bench@yoke', 'add', '-A')
git('-c', 'user.name=bench', '-c', 'user.email=bench@yoke', 'commit', '-q', '-m', 'bench: full Yoke baseline')

const env = {
  ...process.env,
  YOKE_NO_UPDATE_CHECK: '1',
  YOKE_REGISTRY_DIR: join(runRoot, '.routing-registries', basename(runDir)),
}
for (const key of Object.keys(env)) if (key.startsWith('CLAUDE_CODE') || key === 'CLAUDECODE') delete env[key]

const events = []
const started = Date.now()
console.error(`[bench-large] routing=${routing} -> ${runDir}`)
const child = spawn(process.execPath, [
  cli, 'loop', 'run', runDir, '--json', '--runner=codex',
  `--max=${Number(args.max ?? 4)}`, `--timeout=${Number(args.timeout ?? 15)}`,
  routing === 'on' ? '--routing' : '--no-routing', '--unsafe',
], { env, stdio: ['ignore', 'pipe', 'inherit'] })
let buffer = ''
child.stdout.on('data', chunk => {
  buffer += chunk
  let newline
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (!line) continue
    try { events.push({ at: Date.now(), ...JSON.parse(line) }) } catch { /* provider noise is not evidence */ }
  }
})
const exitCode = await new Promise(resolveExit => child.on('close', resolveExit))
const wallClockMs = Date.now() - started

const build = spawnSync(process.execPath, [join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc')], { cwd: runDir, env, encoding: 'utf8', timeout: 10 * 60_000 })
const tests = spawnSync(process.execPath, [join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'), 'run'], { cwd: runDir, env, encoding: 'utf8', timeout: 10 * 60_000 })
const hiddenTargets = acceptanceManifest?.acceptanceTests?.map(test => [String(test.source), String(test.hidden)]) ?? [
  ['tests/routing/large-registry-status.test.ts', 'tests/routing/benchmark-original-status.test.ts'],
  ['tests/routing/large-fallback.test.ts', 'tests/routing/benchmark-original-fallback.test.ts'],
]
for (const [source, target] of hiddenTargets) {
  mkdirSync(dirname(join(runDir, target)), { recursive: true })
  cpSync(join(seed, source), join(runDir, target))
}
const hiddenTests = spawnSync(process.execPath, [
  join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'), 'run',
  ...hiddenTargets.map(([, target]) => target), '--maxWorkers=1',
], { cwd: runDir, env, encoding: 'utf8', timeout: 10 * 60_000 })
for (const [, target] of hiddenTargets) rmSync(join(runDir, target), { force: true })
const finalTestsPass = build.status === 0 && tests.status === 0 && hiddenTests.status === 0
if (!finalTestsPass) {
  console.error('[bench-large] independent final verification failed')
  console.error(build.error ?? build.stderr ?? build.stdout)
  console.error(tests.error ?? tests.stderr ?? tests.stdout)
  console.error(hiddenTests.error ?? hiddenTests.stderr ?? hiddenTests.stdout)
}

const prd = parse(readFileSync(join(runDir, '.yoke', 'prd.yaml'), 'utf8'))
const storyIds = Array.isArray(prd) ? prd.map(story => String(story.id)) : []
const firstSeen = {}
for (const event of events) if (event.story && !(event.story in firstSeen)) firstSeen[event.story] = event.at
const stories = storyIds.map((id, index) => {
  const start = firstSeen[id]
  const next = storyIds.slice(index + 1).map(candidate => firstSeen[candidate]).find(value => value !== undefined)
  return {
    id,
    durationMs: start === undefined ? null : (next ?? started + wallClockMs) - start,
    iterations: new Set(events.filter(event => event.story === id).map(event => event.iteration)).size,
    finalTestsPass,
  }
})
const last = events.at(-1) ?? {}
let status = {}
try { status = JSON.parse(readFileSync(join(runDir, '.yoke', 'loop-status.json'), 'utf8')) } catch { /* early refusal */ }

const sourceStats = root => {
  let files = 0
  let lines = 0
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.(ts|js|mjs)$/.test(entry.name)) {
        files++
        lines += readFileSync(path, 'utf8').split(/\r?\n/).filter(line => line.trim()).length
      }
    }
  }
  walk(root)
  return { files, lines }
}
const stats = sourceStats(join(runDir, 'src'))
const config = parse(readFileSync(join(runDir, '.yoke', 'config.yaml'), 'utf8'))
const inputTokens = Number(status.tokens?.inputTokens ?? 0)
const cachedInputTokens = Number(status.tokens?.cachedInputTokens ?? 0)
const testCount = Number((tests.stdout.match(/Tests\s+(\d+)\s+passed/) ?? [])[1] ?? 0) || null
const result = {
  schemaVersion: 1,
  fixtureVersion,
  runner: 'codex',
  sampleLabel: String(args.label ?? `large-routing-${routing}`),
  permissionProfile: 'unsafe',
  yokeVersion: JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version,
  fixture,
  routing,
  startedAt: new Date(started).toISOString(),
  wallClockMs,
  exitCode,
  finalState: last.state ?? null,
  verdict: exitCode === 0 && finalTestsPass ? 'completed' : 'blocked',
  blocker: exitCode === 0 && finalTestsPass ? null : (status.reason ?? 'loop or independent final verification failed'),
  conflicts: events.filter(event => /conflict/i.test(String(event.reason ?? event.summary ?? ''))).length,
  iterations: stories.reduce((sum, story) => sum + story.iterations, 0),
  finalTestsPass,
  progress: last.progress ?? null,
  usageAvailable: Number(status.tokens?.inputTokens ?? 0) + Number(status.tokens?.outputTokens ?? 0) > 0,
  modelAvailable: Boolean(status.tokens?.model || config?.runner?.model),
  requestedParentModel: config?.runner?.model ?? null,
  tokens: status.tokens ?? null,
  modelCalls: status.tokens?.calls ?? [],
  tokenBreakdown: status.tokens ? {
    inputTokens,
    cachedInputTokens,
    freshInputTokens: Math.max(0, inputTokens - cachedInputTokens),
    cacheWriteInputTokens: Number(status.tokens.cacheWriteInputTokens ?? 0),
    outputTokens: Number(status.tokens.outputTokens ?? 0),
    reasoningOutputTokens: Number(status.tokens.reasoningOutputTokens ?? 0),
    ...(typeof status.tokens.totalCostUsd === 'number' ? { reportedCostUsd: status.tokens.totalCostUsd } : {}),
  } : null,
  stories,
  srcLoc: stats.lines,
  sourceFiles: stats.files,
  finalVerification: {
    buildExitCode: build.status,
    testExitCode: tests.status,
    finalTestCount: testCount,
    originalAcceptanceTestsExitCode: hiddenTests.status,
    originalAcceptanceTestCount: Number(acceptanceManifest?.acceptanceTestCount ?? 4),
  },
}
validateResult(result)
mkdirSync(join(benchDir, 'results'), { recursive: true })
const output = join(benchDir, 'results', `${fixture}-codex-routing-${routing}-${stamp}.json`)
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`)
console.error(`[bench-large] done: ${output}`)
console.log(JSON.stringify(result, null, 2))
