// Controlled live workflow comparison. Run only when authenticated runs are authorized.
// Run after npm run build. See docs/BENCHMARK-MANIFEST.md for scope and limits.
import { cpSync, mkdirSync, readFileSync, writeFileSync, readdirSync, lstatSync, existsSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { arch, cpus, hostname, release, tmpdir, totalmem } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'
import { buildProviderInvocation, startProviderProcess } from '../dist/agents/providers.js'
import { readEvents } from '../dist/observability/events.js'
import { stableComparisonJson } from './result-schema.mjs'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const version = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version
const opts = Object.fromEntries(process.argv.slice(2).map(value => value.replace(/^--/, '').split('=')))
const fixture = opts.fixture ?? 'routing-queue'
if (!['routing-queue', 'string-kit', 'independent-utils'].includes(fixture)) throw new Error('Unsupported fixture')
const repeats = Number(opts.repeats ?? 2)
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('repeats must be 1..10')
const model = opts.model ?? 'gpt-6.1-sol'
const effort = opts.effort ?? 'low'
const root = resolve(opts.root ?? join(tmpdir(), 'ykb-' + Date.now().toString(36)))
mkdirSync(root, { recursive: true })
const seed = join(repo, 'bench', 'fixtures', fixture)
const prdInput = readFileSync(join(seed, '.yoke/prd.yaml'), 'utf8')
const stories = parse(prdInput)
const originalTests = readdirSync(join(seed, 'tests')).filter(file => file.endsWith('.test.mjs')).sort()
const protectedFiles = new Map(['bench-verify.mjs', ...originalTests.map(file => join('tests', file))].map(file => [file, readFileSync(join(seed, file))]))
const digest = value => createHash('sha256').update(value).digest('hex')
const acceptanceDigest = digest(Buffer.concat([...protectedFiles].flatMap(([file, bytes]) => [Buffer.from(file.replaceAll('\\', '/') + '\0'), bytes])))
const prompt = 'Implement all requirements below. Run node bench-verify.mjs. Preserve tests and the verification script. Do not commit.\n' + stories.map(story => story.id + ': ' + story.title + '\n' + story.acceptance.join('\n')).join('\n\n')
const results = []
const requestedArms = opts.arms?.split(',')
if (requestedArms && (!requestedArms.length || requestedArms.some(arm => !['codex', 'yoke-serial', 'yoke-parallel'].includes(arm)))) throw new Error('arms must name codex,yoke-serial,yoke-parallel')
const baseArms = fixture === 'independent-utils' ? ['codex', 'yoke-serial', 'yoke-parallel'] : ['codex', 'yoke-serial']
const selectedArms = requestedArms ? baseArms.filter(arm => requestedArms.includes(arm)) : baseArms
if (!selectedArms.length) throw new Error('No requested arms apply to this fixture')
const manifest = {
  schemaVersion: 1, id: randomUUID(), kind: 'workflow', arms: selectedArms, repeats,
  allowedDifferences: [
    { field: 'execution.workflow', reason: 'One direct provider session versus the normal Yoke story workflow' },
    { field: 'execution.parallel', reason: 'The explicitly selected parallel arm uses three Yoke workers' },
    { field: 'execution.promptDigest', reason: 'Workflow inputs differ while the fixture requirements and acceptance remain identical' },
    { field: 'execution.promptScope', reason: 'Direct provider prompt versus PRD/configuration inputs expanded by Yoke' },
    { field: 'startup.ignoreRules', reason: 'Preserve the documented direct-arm ignore-rules flag; Yoke retains normal project rule handling' },
    { field: 'startup.commitPolicy', reason: 'Direct arm is instructed not to commit; Yoke performs its normal story commits' },
    { field: 'startup.isolation', reason: 'Yoke uses its normal isolated worktrees inside a fresh fixture' },
    { field: 'startup.timeoutPolicy', reason: 'Direct session deadline versus bounded Yoke story dispatches' },
    { field: 'startup.userStatePolicy', reason: 'Yoke runtime registry is isolated using LOCALAPPDATA; direct CLI keeps inherited state' },
  ],
}
const limits = [
  'Small fixture sample; not representative of production projects',
  'Workflow comparison includes declared prompt, commit, isolation, timeout and rule-policy differences',
  'CPU and RAM not measured; host background load is uncontrolled',
  'Routing disabled; fixed requested model and effort; missing reported model identity prevents a verified comparison',
  'Immutable tests replayed after execution; visible to agents, not hidden tests',
  'User config disabled; installed plugins and discovered skills are not fully audited',
  'Prompt digests bind submitted workflow inputs, not provider system prompts or every dynamically expanded Yoke prompt',
  'Wall time starts after fixture setup and ends at runner exit; independent acceptance time is recorded separately',
]
function hashPaths(base, paths) {
  const hash = createHash('sha256')
  function visit(relative) {
    const path = join(base, relative)
    const label = relative.replaceAll('\\', '/')
    if (!existsSync(path)) { hash.update('missing:' + label + '\0'); return }
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw new Error('Cannot certify linked benchmark input: ' + label)
    if (stat.isDirectory()) {
      hash.update('directory:' + label + '\0')
      for (const name of readdirSync(path).sort()) visit(join(relative, name))
    } else if (stat.isFile()) {
      const bytes = readFileSync(path)
      hash.update(Buffer.byteLength(label) + ':' + label + ':' + bytes.length + ':')
      hash.update(bytes)
    } else throw new Error('Unsupported benchmark input: ' + label)
  }
  for (const path of [...paths].sort()) visit(path)
  return hash.digest('hex')
}
function git(args) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}
function sourceSnapshot() {
  const gitRoot = git(['rev-parse', '--show-toplevel'])
  const sameRoot = gitRoot && (process.platform === 'win32' ? resolve(gitRoot).toLowerCase() === repo.toLowerCase() : resolve(gitRoot) === repo)
  const status = sameRoot ? git(['status', '--porcelain', '--untracked-files=normal']) : null
  return {
    version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version,
    commit: sameRoot ? git(['rev-parse', 'HEAD']) : null,
    dirty: status === null ? null : status.length > 0,
    // Hash actual runtime artifacts even on a clean checkout: dist may be stale or untracked.
    buildDigest: hashPaths(repo, ['dist', 'canon', 'agents', 'hooks', 'package.json', 'package-lock.json', 'bench/compare-codex.mjs', 'bench/result-schema.mjs']),
  }
}
function environmentSnapshot() {
  const provider = spawnSync('codex', ['--version'], { encoding: 'utf8', timeout: 20_000, shell: process.platform === 'win32' })
  return {
    platform: process.platform, arch: arch(), nodeVersion: process.version,
    providerVersion: provider.status === 0 ? provider.stdout.trim() || null : null,
    hostDigest: digest(stableComparisonJson({ hostname: hostname(), platform: process.platform, release: release(), arch: arch(), cpus: cpus().map(cpu => cpu.model), memory: totalmem() })),
    hostLoad: 'uncontrolled', skillsPlugins: 'not-audited',
  }
}
function reportedModelsFromEvents(dir) {
  const records = readEvents(dir, 1000).filter(event => event.type === 'tokens')
  const calls = records.flatMap(event => Array.isArray(event.data?.calls) && event.data.calls.length ? event.data.calls : [event.data ?? {}])
  const models = calls.map(call => call.actualModel ?? call.model)
  return models.length && models.every(value => typeof value === 'string' && value) ? [...new Set(models)].sort() : null
}
const fixtureContext = {
  id: fixture, seedDigest: hashPaths(seed, ['.']),
  acceptanceDigest, requirementsDigest: digest(stableComparisonJson(stories)),
}
for (let repeat = 0; repeat < repeats; repeat++) {
  const arms = repeat % 2 ? [...selectedArms].reverse() : selectedArms
  for (const arm of arms) {
    const before = sourceSnapshot()
    const environment = environmentSnapshot()
    const dir = join(root, String(repeat + 1) + '-' + arm)
    mkdirSync(dir)
    cpSync(seed, dir, { recursive: true })
    const parallel = arm === 'yoke-parallel' ? 3 : 1
    const configInput = stringify({ canonVersion: '1.2.0', agents: ['codex'], loop: { enabled: true, parallel, isolate: true }, runner: { agent: 'codex', model, reasoningEffort: effort, bare: true }, routing: { enabled: false }, verify: { command: 'node bench-verify.mjs' } })
    writeFileSync(join(dir, '.yoke/config.yaml'), configInput)
    for (const args of [['init', '-q'], ['add', '-A'], ['-c', 'user.name=benchmark', '-c', 'user.email=benchmark@yoke.local', 'commit', '-qm', 'Immutable fixture seed']]) {
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      if (result.status !== 0) throw new Error(result.stderr)
    }
    console.log(JSON.stringify({ type: 'start', comparisonId: manifest.id, fixture, repeat: repeat + 1, arm, model, effort, dir }))
    const start = Date.now()
    let outcome, usage, actualModels = null
    let events = []
    if (arm === 'codex') {
      const invocation = buildProviderInvocation('codex', prompt, dir, 'unsafe', { model, reasoningEffort: effort, bare: true, nativeMultiAgent: false })
      // Historical workflow policy is retained and explicitly declared, not silently equalized.
      invocation.args.push('--ignore-rules')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 600_000)
      try {
        const result = await startProviderProcess('codex', invocation, { signal: controller.signal, idleTimeoutMs: 180_000 }).completion
        outcome = result.kind
        usage = result.telemetry.tokens
        const reported = result.telemetry.reportedModels ?? (usage?.model ? [usage.model] : [])
        actualModels = reported.length ? [...new Set(reported)].sort() : null
        writeFileSync(join(root, fixture + '-' + (repeat + 1) + '-' + arm + '.log'), JSON.stringify(result, null, 2))
      } finally { clearTimeout(timer) }
    } else {
      const child = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'loop', 'run', dir, '--json', '--runner=codex', '--no-routing', '--parallel=' + parallel, '--max=3', '--timeout=10', '--unsafe'], { cwd: dir, env: { ...process.env, LOCALAPPDATA: join(root, 'state') }, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = '', errors = ''
      child.stdout.on('data', data => { output += data })
      child.stderr.on('data', data => { errors += data })
      outcome = await new Promise((resolveExit, reject) => { child.on('error', reject); child.on('close', resolveExit) })
      events = output.split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
      writeFileSync(join(root, fixture + '-' + (repeat + 1) + '-' + arm + '.log'), output + '\nSTDERR\n' + errors)
      usage = events.filter(event => event.type === 'status' && event.tokens).at(-1)?.tokens
      actualModels = reportedModelsFromEvents(dir)
    }
    const wallMs = Date.now() - start
    // Replay immutable originals after the agent exits. Agent-written tests never determine quality.
    mkdirSync(join(dir, 'tests'), { recursive: true })
    for (const [file, bytes] of protectedFiles) writeFileSync(join(dir, file), bytes)
    const checkStart = Date.now()
    const check = spawnSync(process.execPath, ['--test', ...originalTests.map(file => join('tests', file))], { cwd: dir, encoding: 'utf8', timeout: 60_000 })
    const acceptanceMs = Date.now() - checkStart
    writeFileSync(join(root, fixture + '-' + (repeat + 1) + '-' + arm + '.acceptance.log'), check.stdout + check.stderr)
    const after = sourceSnapshot()
    const context = {
      source: { ...before, stable: stableComparisonJson(before) === stableComparisonJson(after) && hashPaths(seed, ['.']) === fixtureContext.seedDigest },
      fixture: fixtureContext,
      execution: {
        provider: 'codex', requestedModel: model, actualModels, effort, routing: false, nativeMultiAgent: false, nativeGoal: false, parallel,
        workflow: arm === 'codex' ? 'direct-provider-session' : 'yoke-story-loop',
        promptDigest: digest(arm === 'codex' ? prompt : stableComparisonJson({ prdInput, configInput })),
        promptScope: arm === 'codex' ? 'provider-prompt' : 'workflow-input-bundle',
      },
      startup: {
        permissionProfile: 'unsafe', bare: true, ignoreRules: arm === 'codex',
        commitPolicy: arm === 'codex' ? 'instructed-no-commit' : 'normal-story-commits',
        isolation: arm === 'codex' ? 'fresh-fixture' : 'fresh-fixture-and-story-worktrees',
        timeoutPolicy: arm === 'codex' ? '600000ms session; 180000ms idle' : 'three dispatches; 600000ms per runner',
        userStatePolicy: arm === 'codex' ? 'inherited' : 'isolated-LOCALAPPDATA',
      },
      environment,
    }
    const result = { fixture, repeat: repeat + 1, arm, model, effort, routing: false, nativeMultiAgent: false, parallel, acceptanceDigest, context, wallMs, acceptanceMs, accepted: check.status === 0, outcome, usage: usage ?? null, events: events.length, dir }
    results.push(result)
    writeFileSync(join(root, 'results.json'), JSON.stringify({ schemaVersion: 2, version, manifest, root, results, limits }, null, 2))
    console.log(JSON.stringify({ type: 'result', comparisonId: manifest.id, ...result }))
  }
}
