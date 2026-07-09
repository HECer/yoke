#!/usr/bin/env node
// Yoke benchmark harness.
//
//   node bench/run.mjs --runner=claude [--max=6] [--timeout=10] [--label=note]
//
// Copies the fixture into bench/.runs/<runner>-<stamp>, git-inits it, then drives
// `yoke loop run --json` and measures from the OUTSIDE (the loop itself records no
// durations): per-story wall-clock from NDJSON event timestamps, tokens/model from
// the loop's token hook (claude runner only), and quality as the fixture's own
// pre-written tests — run per story AFTER the loop finishes, on the final tree.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  console.error('usage: node bench/run.mjs --runner=<claude|codex|gemini> [--max=6] [--timeout=10] [--label=note]')
  process.exit(2)
}
const max = Number(args.max ?? 6)
const timeout = Number(args.timeout ?? 10)

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const runDir = join(benchDir, '.runs', `${runner}-${stamp}`)
mkdirSync(runDir, { recursive: true })
cpSync(join(benchDir, 'fixtures', 'string-kit'), runDir, { recursive: true })

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

console.error(`[bench] ${runner} → ${runDir}`)
const t0 = Date.now()
const events = []
const child = spawn(process.execPath, [cli, 'loop', 'run', runDir, '--json', `--runner=${runner}`, `--max=${max}`, `--timeout=${timeout}`], {
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
const storyIds = ['STORY-1', 'STORY-2', 'STORY-3']
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
  runner,
  label: args.label ?? null,
  yokeVersion: JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version,
  fixture: 'string-kit',
  startedAt: new Date(t0).toISOString(),
  wallClockMs,
  exitCode,
  finalState: last.state ?? null,
  progress: last.progress ?? null,
  tokens: status.tokens ?? null, // claude runner only; gemini/codex report none (documented gap)
  stories,
  srcLoc: loc(join(runDir, 'src')),
}

mkdirSync(join(benchDir, 'results'), { recursive: true })
const out = join(benchDir, 'results', `${runner}-${stamp}.json`)
writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
console.error(`[bench] done: ${out}`)
console.log(JSON.stringify(result, null, 2))
