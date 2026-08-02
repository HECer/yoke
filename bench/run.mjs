#!/usr/bin/env node
// Yoke benchmark harness.
//
//   node bench/run.mjs --runner=claude [--fixture=string-kit] [--routing=on|off|config]
//
// Copies the fixture into bench/.runs/<runner>-<stamp>, git-inits it, then drives
// `yoke loop run --json` and measures from the OUTSIDE (the loop itself records no
// durations): per-story wall-clock from NDJSON event timestamps, tokens/model from
// provider telemetry when available, and quality as the fixture's own
// pre-written tests — run per story AFTER the loop finishes, on the final tree.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateResult } from './result-schema.mjs'
import { parse } from 'yaml'

const benchDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(benchDir)
const cli = join(repoRoot, 'dist', 'cli.js')

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
    const [k, v] = a.slice(2).split('=')
    return [k, v ?? true]
  }),
)
const runner = args.runner
if (!['claude', 'codex', 'gemini'].includes(runner)) {
  console.error('usage: node bench/run.mjs --runner=<claude|codex|gemini> [--fixture=string-kit] [--routing=on|off|config] [--run-root=path] [--unsafe] [--max=6] [--timeout=10] [--label=note]')
  process.exit(2)
}
const max = Number(args.max ?? 6)
const timeout = Number(args.timeout ?? 10)
const fixture = String(args.fixture ?? 'string-kit')
const fixtureDir = join(benchDir, 'fixtures', fixture)
const routing = String(args.routing ?? 'config')
if (!existsSync(fixtureDir)) {
  console.error(`unknown fixture: ${fixture}`)
  process.exit(2)
}
if (!['on', 'off', 'config'].includes(routing)) {
  console.error('routing must be on, off, or config')
  process.exit(2)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const runRoot = args['run-root'] ? String(args['run-root']) : join(benchDir, '.runs')
const runDir = join(runRoot, `${fixture}-${runner}-routing-${routing}-${stamp}`)
mkdirSync(runDir, { recursive: true })
cpSync(fixtureDir, runDir, { recursive: true })

const git = (...a) => {
  const r = spawnSync('git', ['-C', runDir, ...a], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${a.join(' ')} failed: ${r.stderr}`)
}
git('init', '-q')
git('-c', 'user.name=bench', '-c', 'user.email=bench@yoke', 'add', '-A')
git('-c', 'user.name=bench', '-c', 'user.email=bench@yoke', 'commit', '-q', '-m', 'bench: fixture baseline')

// A nested Claude Code session refuses some operations; scrub session markers.
const env = { ...process.env }
for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_CODE') || k === 'CLAUDECODE') delete env[k]

console.error(`[bench] ${runner} · fixture=${fixture} · routing=${routing} → ${runDir}`)
const t0 = Date.now()
const events = []
const routingFlag = routing === 'on' ? ['--routing'] : routing === 'off' ? ['--no-routing'] : []
const permissionFlag = args.unsafe ? ['--unsafe'] : []
const child = spawn(process.execPath, [cli, 'loop', 'run', runDir, '--json', `--runner=${runner}`, `--max=${max}`, `--timeout=${timeout}`, ...routingFlag, ...permissionFlag], {
  env, stdio: ['ignore', 'pipe', 'inherit'],
})
let buf = ''
child.stdout.on('data', d => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    try { events.push({ at: Date.now(), ...JSON.parse(line) }) } catch { /* non-JSON noise */ }
  }
})
const exitCode = await new Promise(res => child.on('close', res))
const wallClockMs = Date.now() - t0

// Per-story duration: first event mentioning the story -> first event mentioning the next story (or end).
const prd = parse(readFileSync(join(runDir, '.yoke', 'prd.yaml'), 'utf8'))
const storyIds = Array.isArray(prd) ? prd.map(story => String(story.id)) : []
const benchConfig = parse(readFileSync(join(runDir, '.yoke', 'config.yaml'), 'utf8'))
const requestedParentModel = benchConfig?.runner?.model ?? null
const firstSeen = {}
for (const e of events) if (e.story && !(e.story in firstSeen)) firstSeen[e.story] = e.at
const stories = storyIds.map((id, idx) => {
  const start = firstSeen[id]
  const next = storyIds.slice(idx + 1).map(n => firstSeen[n]).find(v => v !== undefined)
  const durationMs = start === undefined ? null : (next ?? t0 + wallClockMs) - start
  const iterations = new Set(events.filter(e => e.story === id).map(e => e.iteration)).size
  // Quality: the fixture's own tests for this story, on the final tree.
  const q = spawnSync(process.execPath, ['--test', `tests/${id}.test.mjs`], { cwd: runDir, encoding: 'utf8' })
  return { id, durationMs, iterations, finalTestsPass: q.status === 0 }
})

const last = events[events.length - 1] ?? {}
let status = {}
try { status = JSON.parse(readFileSync(join(runDir, '.yoke', 'loop-status.json'), 'utf8')) } catch { /* loop may have refused before writing status */ }

// Source size (LOC in src/) as a code-economy proxy.
const loc = (dir) => readdirSync(dir).reduce((n, f) => {
  const p = join(dir, f)
  if (statSync(p).isDirectory()) return n + loc(p)
  return n + readFileSync(p, 'utf8').split('\n').filter(l => l.trim() !== '').length
}, 0)

const result = {
  schemaVersion: 1,
  fixtureVersion: `${fixture}@1`,
  runner,
  sampleLabel: String(args.label ?? `${runner}-${stamp}`),
  permissionProfile: args.unsafe ? 'unsafe' : 'safe',
  yokeVersion: JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version,
  fixture,
  routing,
  startedAt: new Date(t0).toISOString(),
  wallClockMs,
  exitCode,
  finalState: last.state ?? null,
  verdict: exitCode === 0 ? 'completed' : (/api key|login|auth/i.test(String(status.reason ?? '')) ? 'auth-failed' : 'blocked'),
  blocker: exitCode === 0 ? null : (status.reason ?? 'runner exited without a diagnostic'),
  conflicts: events.filter(e => /conflict/i.test(String(e.reason ?? e.summary ?? ''))).length,
  iterations: stories.reduce((sum, story) => sum + story.iterations, 0),
  finalTestsPass: stories.every(story => story.finalTestsPass),
  progress: last.progress ?? null,
  usageAvailable: Number(status.tokens?.inputTokens ?? 0) + Number(status.tokens?.outputTokens ?? 0) > 0,
  modelAvailable: (typeof status.tokens?.model === 'string' && status.tokens.model !== '<synthetic>') || requestedParentModel !== null,
  requestedParentModel,
  tokens: status.tokens ?? null,
  modelCalls: status.tokens?.calls ?? [],
  stories,
  srcLoc: loc(join(runDir, 'src')),
}
validateResult(result)

mkdirSync(join(benchDir, 'results'), { recursive: true })
const out = join(benchDir, 'results', `${fixture}-${runner}-routing-${routing}-${stamp}.json`)
writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
console.error(`[bench] done: ${out}`)
console.log(JSON.stringify(result, null, 2))
