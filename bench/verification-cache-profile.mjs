#!/usr/bin/env node
// Local deterministic fixtures only. JSON goes to stdout; checked-in results are never rewritten.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

const script = fileURLToPath(import.meta.url)
const repository = fs.realpathSync(resolve(dirname(script), '..'))
const baselineRef = 'a97c5e09aee68c00acede09c92753f56ac754ecb'
const sourcePaths = ['src/loop/verification-cache.ts', 'src/workspace/fingerprint.ts']
const sha256 = value => createHash('sha256').update(value).digest('hex')

async function measure(modulePath, fixture) {
  const counters = { workspaceBytes: 0, runtimeBytes: 0, largestRead: 0, readFileCalls: 0, readSyncCalls: 0 }
  const descriptors = new Map(), runtimePath = fs.realpathSync(process.execPath)
  const original = { read: fs.readFileSync, open: fs.openSync, close: fs.closeSync, readSync: fs.readSync }
  let wholeReadDepth = 0
  const pathName = value => value instanceof URL ? fileURLToPath(value) : String(value)
  const count = (path, bytes) => {
    const name = typeof path === 'number' ? descriptors.get(path) : pathName(path)
    if (!name) return
    const child = relative(fixture, name)
    if (child !== '..' && !child.startsWith('../') && !child.startsWith('..\\') && !isAbsolute(child)) counters.workspaceBytes += bytes
    else if (name === process.execPath || name === runtimePath) counters.runtimeBytes += bytes
    else return
    counters.largestRead = Math.max(counters.largestRead, bytes)
  }
  fs.readFileSync = function(path, ...args) {
    wholeReadDepth++
    try {
      const value = original.read.call(fs, path, ...args)
      counters.readFileCalls++
      count(path, Buffer.isBuffer(value) ? value.length : Buffer.byteLength(value))
      return value
    } finally { wholeReadDepth-- }
  }
  fs.openSync = function(path, ...args) { const fd = original.open.call(fs, path, ...args); descriptors.set(fd, pathName(path)); return fd }
  fs.closeSync = function(fd) { descriptors.delete(fd); return original.close.call(fs, fd) }
  fs.readSync = function(fd, ...args) {
    const bytes = original.readSync.call(fs, fd, ...args)
    // readFileSync may call readSync internally. Count its bytes only once.
    if (!wholeReadDepth) { counters.readSyncCalls++; count(fd, bytes) }
    return bytes
  }
  syncBuiltinESMExports()
  const { createVerificationSession } = await import(pathToFileURL(modulePath).href)
  const session = createVerificationSession()
  for (const key of Object.keys(counters)) counters[key] = 0
  const started = performance.now()
  session.run(fixture, 'fixture-pure-command', 'criterion', () => ({ passed: true, summary: 'passed' }))
  session.run(fixture, 'fixture-pure-command', 'criterion', () => ({ passed: true, summary: 'passed' }))
  return { ...counters, elapsedMs: performance.now() - started, peakRssKiB: process.resourceUsage().maxRSS, stats: session.stats(), diagnostics: session.diagnostics?.() }
}

async function compileSources(temporary, baselineCommit) {
  // Compile in a separate process: compiler allocations must not affect the
  // benchmark parent's memory inherited by later measurement subprocesses.
  const ts = (await import('typescript')).default
  const modules = {}, sources = {}
  for (const version of ['before', 'after']) {
    const directory = join(temporary, 'modules', version)
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(join(directory, 'package.json'), '{"type":"module"}\n')
    sources[version] = {}
    for (const path of sourcePaths) {
      const source = version === 'before' ? execFileSync('git', ['show', `${baselineCommit}:${path}`], { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024, timeout: 30_000 }) : fs.readFileSync(join(repository, path), 'utf8')
      sources[version][path] = sha256(source)
      const compiled = ts.transpileModule(source, {
        fileName: path, reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, newLine: ts.NewLineKind.LineFeed },
      })
      const errors = compiled.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error) ?? []
      if (errors.length) throw Error(errors.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('\n'))
      const output = join(directory, path.replace(/\.ts$/, '.js'))
      fs.mkdirSync(dirname(output), { recursive: true })
      fs.writeFileSync(output, compiled.outputText)
    }
    modules[version] = join(directory, 'src/loop/verification-cache.js')
  }
  return { modules, sources, typescript: ts.version }
}

async function profile() {
  const temporary = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'yoke-verification-profile-')))
  try {
    const gitEnvironment = { ...process.env }
    for (const key of Object.keys(gitEnvironment)) if (key.startsWith('GIT_')) delete gitEnvironment[key]
    const globalConfig = join(temporary, 'empty-git-config')
    fs.writeFileSync(globalConfig, '')
    Object.assign(gitEnvironment, { GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' })
    const git = (args, cwd = repository) => execFileSync('git', args, { cwd, env: gitEnvironment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024, timeout: 30_000 })
    let baselineCommit
    try { baselineCommit = git(['rev-parse', '--verify', `${baselineRef}^{commit}`]).trim() }
    catch { throw Error(`Baseline ${baselineRef} must be present in local Git history. Fetch that history before running this profile; the script does not access the network.`) }
    const { modules, sources, typescript } = JSON.parse(execFileSync(process.execPath, [script, '--compile', temporary, baselineCommit], {
      cwd: repository, env: gitEnvironment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024, timeout: 30_000,
    }))
    const fixture = join(temporary, 'fixture')
    fs.mkdirSync(join(fixture, 'source'), { recursive: true })
    git(['init', '--quiet'], fixture)
    for (let i = 0; i < 8; i++) fs.writeFileSync(join(fixture, 'source', `${i}.bin`), Buffer.alloc(2 * 1024 * 1024, i))
    fs.writeFileSync(join(fixture, '.gitignore'), 'ignored.bin\n')
    git(['add', '.'], fixture)
    const result = {
      schemaVersion: 1, measuredAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
      baselineCommit, candidateCommit: git(['rev-parse', 'HEAD']).trim(), typescript, sourceSha256: sources,
      note: 'Single local fixtures, separate Node processes, shared environment. Current working-tree source is transpiled locally; dist is not used. Node filesystem byte counters exclude Git subprocess I/O. Timing/RSS are observations, not end-to-end or Rust speed claims.',
      fixtures: {},
    }
    for (const [label, ignoredMiB, expected] of [['eligible_32mib', 16, { executed: 1, reused: 1 }], ['oversized_81mib', 65, { executed: 2, reused: 0 }]]) {
      fs.writeFileSync(join(fixture, 'ignored.bin'), Buffer.alloc(ignoredMiB * 1024 * 1024, 7))
      const observed = {}
      for (const version of ['before', 'after']) {
        observed[version] = JSON.parse(execFileSync(process.execPath, [script, '--child', modules[version], fixture], {
          cwd: repository, env: gitEnvironment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024, timeout: 60_000,
        }))
        if (observed[version].stats.executed !== expected.executed || observed[version].stats.reused !== expected.reused) throw Error(`${version}/${label}: command execution/reuse behavior changed; inspect the fixture before comparing performance.`)
      }
      result.fixtures[label] = observed
    }
    return result
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
}

try {
  if (process.argv[2] === '--child' && process.argv.length === 5) process.stdout.write(JSON.stringify(await measure(process.argv[3], process.argv[4])) + '\n')
  else if (process.argv[2] === '--compile' && process.argv.length === 5) process.stdout.write(JSON.stringify(await compileSources(process.argv[3], process.argv[4])) + '\n')
  else if (process.argv.length === 2) process.stdout.write(JSON.stringify(await profile(), null, 2) + '\n')
  else if (process.argv[2] === '--help') process.stdout.write('Usage: node bench/verification-cache-profile.mjs\nRequires Git history containing a97c5e0 and installed development dependencies. Prints new JSON measurements to stdout; creates only disposable temporary fixtures.\n')
  else throw Error('Usage: node bench/verification-cache-profile.mjs')
} catch (error) { console.error(`Verification cache profile: ${error.message}`); process.exitCode = 1 }
