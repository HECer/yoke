// Controlled live comparison. Run after npm run build.
// node bench/compare-codex.mjs --repeats=2 --fixture=routing-queue
import { cpSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'
import { buildProviderInvocation, startProviderProcess } from '../dist/agents/providers.js'
const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const version = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version
const opts = Object.fromEntries(process.argv.slice(2).map(x => x.replace(/^--/, '').split('=')))
const fixture = opts.fixture ?? 'routing-queue'
if (!['routing-queue', 'string-kit', 'independent-utils'].includes(fixture)) throw new Error('Unsupported fixture')
const repeats = Number(opts.repeats ?? 2)
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('repeats must be 1..10')
const model = opts.model ?? 'gpt-6.1-sol'
const root = resolve(opts.root ?? `G:/NN-Developed/Yoke-Testground/b${Date.now().toString(36)}`)
mkdirSync(root, { recursive: true })
const seed = join(repo, 'bench', 'fixtures', fixture)
const stories = parse(readFileSync(join(seed, '.yoke/prd.yaml'), 'utf8'))
const originalTests = readdirSync(join(seed, 'tests')).filter(f => f.endsWith('.test.mjs')).sort()
const protectedFiles = new Map(['bench-verify.mjs', ...originalTests.map(f => join('tests', f))].map(file => [file, readFileSync(join(seed, file))]))
const acceptanceDigest = createHash('sha256').update(Buffer.concat([...protectedFiles].flatMap(([file, bytes]) => [Buffer.from(file + '\0'), bytes]))).digest('hex')
const prompt = 'Implement all requirements below. Run node bench-verify.mjs. Preserve tests and the verification script. Do not commit.\n' + stories.map(s => `${s.id}: ${s.title}\n${s.acceptance.join('\n')}`).join('\n\n')
const results = []
const requestedArms = opts.arms?.split(',')
if (requestedArms && (!requestedArms.length || requestedArms.some(arm => !['codex', 'yoke-serial', 'yoke-parallel'].includes(arm)))) throw new Error('arms must name codex,yoke-serial,yoke-parallel')
for (let repeat = 0; repeat < repeats; repeat++) {
  const baseArms = fixture === 'independent-utils' ? ['codex', 'yoke-serial', 'yoke-parallel'] : ['codex', 'yoke-serial']
  const selectedArms = requestedArms ? baseArms.filter(arm => requestedArms.includes(arm)) : baseArms
  if (!selectedArms.length) throw new Error('No requested arms apply to this fixture')
  const arms = repeat % 2 ? [...selectedArms].reverse() : selectedArms
  for (const arm of arms) {
    const dir = join(root, `${repeat + 1}-${arm}`)
    mkdirSync(dir); cpSync(seed, dir, { recursive: true })
    const parallel = arm === 'yoke-parallel' ? 3 : 1
    writeFileSync(join(dir, '.yoke/config.yaml'), stringify({ canonVersion: '1.2.0', agents: ['codex'], loop: { enabled: true, parallel, isolate: true }, runner: { agent: 'codex', model, reasoningEffort: 'low', bare: true }, routing: { enabled: false }, verify: { command: 'node bench-verify.mjs' } }))
    for (const args of [['init', '-q'], ['add', '-A'], ['-c', 'user.name=benchmark', '-c', 'user.email=benchmark@yoke.local', 'commit', '-qm', 'Immutable fixture seed']]) {
      const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr)
    }
    console.log(JSON.stringify({ type: 'start', fixture, repeat: repeat + 1, arm, model, dir }))
    const start = Date.now(); let outcome; let events = []; let usage
    if (arm === 'codex') {
      const inv = buildProviderInvocation('codex', prompt, dir, 'unsafe', { model, reasoningEffort: 'low', bare: true, nativeMultiAgent: false })
      inv.args.push('--ignore-rules')
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 600_000)
      try {
        const r = await startProviderProcess('codex', inv, { signal: controller.signal, idleTimeoutMs: 180_000 }).completion
        outcome = r.kind; usage = r.telemetry.tokens
        writeFileSync(join(root, `${fixture}-${repeat + 1}-${arm}.log`), JSON.stringify(r, null, 2))
      } finally { clearTimeout(timer) }
    } else {
      const child = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'loop', 'run', dir, '--json', '--runner=codex', '--no-routing', `--parallel=${parallel}`, '--max=3', '--timeout=10', '--unsafe'], { cwd: dir, env: { ...process.env, LOCALAPPDATA: join(root, 'state') }, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = '', errors = ''; child.stdout.on('data', d => { output += d }); child.stderr.on('data', d => { errors += d })
      outcome = await new Promise((res, rej) => { child.on('error', rej); child.on('close', res) })
      events = output.split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
      writeFileSync(join(root, `${fixture}-${repeat + 1}-${arm}.log`), output + '\nSTDERR\n' + errors)
      usage = events.filter(e => e.type === 'status' && e.tokens).at(-1)?.tokens
    }
    const wallMs = Date.now() - start
    // Replay immutable originals after the agent exits. Agent-written tests never determine quality.
    mkdirSync(join(dir, 'tests'), { recursive: true })
    for (const [file, bytes] of protectedFiles) writeFileSync(join(dir, file), bytes)
    const testFiles = originalTests.map(f => join('tests', f))
    const checkStart = Date.now(); const check = spawnSync(process.execPath, ['--test', ...testFiles], { cwd: dir, encoding: 'utf8', timeout: 60_000 })
    writeFileSync(join(root, `${fixture}-${repeat + 1}-${arm}.acceptance.log`), check.stdout + check.stderr)
    const result = { fixture, repeat: repeat + 1, arm, model, effort: 'low', routing: false, nativeMultiAgent: false, parallel, acceptanceDigest, wallMs, acceptanceMs: Date.now() - checkStart, accepted: check.status === 0, outcome, usage: usage ?? null, events: events.length, dir }
    results.push(result); writeFileSync(join(root, 'results.json'), JSON.stringify({ version, root, results, limits: ['Small fixture sample; not representative of production projects', 'CPU and RAM not measured', 'Routing disabled; fixed model and effort', 'Immutable tests replayed after execution; not hidden from agents', 'User config disabled; not an audit of every installed plugin'] }, null, 2)); console.log(JSON.stringify({ type: 'result', ...result }))
  }
}
