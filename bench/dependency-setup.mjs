import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, parse, resolve } from 'node:path'

const RECEIPT = '.yoke-dependency-setup.json'
const CACHE_PATHS = ['node_modules', '.yoke', '.cache', '.vite', '.vite-temp', 'node_modules/.cache', 'node_modules/.vite', 'node_modules/.vite-temp']
const sha256 = value => createHash('sha256').update(value).digest('hex')
const problem = kind => Object.assign(new Error(kind), { setupKind: kind })

function noLinks(path) {
  const absolute = resolve(path), parts = absolute.slice(parse(absolute).root.length).split(/[\\/]/).filter(Boolean)
  let current = parse(absolute).root
  for (const part of parts) {
    current = join(current, part)
    try { if (lstatSync(current).isSymbolicLink()) throw problem('unsafe-path') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return absolute
}
function safePaths(root, cache) {
  for (const path of CACHE_PATHS) {
    const full = noLinks(join(root, path))
    if (existsSync(full) && !lstatSync(full).isDirectory()) throw problem('unsafe-path')
  }
  noLinks(join(root, 'node_modules', RECEIPT))
  noLinks(cache)
  if (existsSync(cache) && !lstatSync(cache).isDirectory()) throw problem('unsafe-path')
}
function inputBytes(root) {
  const result = {}
  for (const name of ['package.json', 'package-lock.json']) {
    const path = noLinks(join(root, name))
    if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).size > 64 * 1024 * 1024) throw problem('invalid-input')
    const bytes = readFileSync(path)
    let value
    try { value = JSON.parse(bytes.toString('utf8')) } catch { throw problem('invalid-input') }
    if (!value || typeof value !== 'object' || Array.isArray(value) || (name === 'package-lock.json' && !Number.isInteger(value.lockfileVersion))) throw problem('invalid-input')
    result[name] = sha256(bytes)
  }
  return result
}
function defaultNpm() {
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')]
  try { candidates.push(createRequire(import.meta.url).resolve('npm/bin/npm-cli.js')) } catch { /* system npm can still be on PATH */ }
  const cli = candidates.find(path => path && path.endsWith('npm-cli.js') && existsSync(path))
  return cli ? { command: process.execPath, args: [cli] } : { command: 'npm', args: [] }
}
function npmFailure(result) {
  if (result.spawnCode) return { kind: 'spawn', causeCode: ['ENOENT', 'EACCES', 'EPERM'].includes(result.spawnCode) ? result.spawnCode : 'SPAWN_FAILED' }
  if (result.timedOut) return { kind: 'timeout', causeCode: 'ETIMEDOUT' }
  if (result.captureExceeded) return { kind: 'unknown', causeCode: 'OUTPUT_LIMIT' }
  for (const output of [result.stdout, result.stderr]) {
    let code
    try { code = JSON.parse(output)?.error?.code } catch { continue }
    if (code === 'ENOCACHE') return { kind: 'offline-cache-miss', causeCode: code }
    if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'ETIMEDOUT'].includes(code)) return { kind: 'network', causeCode: code }
    if (['E401', 'E403', 'EAUTH'].includes(code)) return { kind: 'authentication', causeCode: code }
  }
  return { kind: 'unknown' }
}
function runNpm(npm, args, root, env, timeoutMs) {
  return new Promise(resolveResult => {
    const child = spawn(npm.command, [...(npm.args ?? []), ...args], { cwd: root, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    const result = { stdout: '', stderr: '', status: null, spawnCode: undefined, timedOut: false, captureExceeded: false }
    let captured = 0
    const stop = () => {
      if (!child.pid) return
      if (process.platform === 'win32') {
        // npm lifecycle scripts are disabled; kill its process tree on cancellation.
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.on('error', () => child.kill('SIGKILL'))
      } else { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }
    }
    const timer = setTimeout(() => { result.timedOut = true; stop() }, timeoutMs)
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => {
      captured += chunk.length
      if (captured > 128 * 1024) { result.captureExceeded = true; stop() }
      else result[stream] += chunk.toString('utf8')
    })
    child.on('error', error => { result.spawnCode = error.code ?? 'SPAWN_FAILED' })
    child.on('close', status => { clearTimeout(timer); result.status = status; resolveResult(result) })
  })
}

/** Benchmark-owned npm provisioning only. Receipts attest matching setup inputs,
 * not the integrity of every installed byte. No lifecycle scripts or automatic retry. */
export async function setupNpmDependencies(projectDir, options = {}) {
  const started = performance.now()
  let receiptPath
  let fingerprint
  const finish = value => ({ ...value, durationMs: performance.now() - started, ...(fingerprint ? { fingerprint } : {}), ...(receiptPath ? { receiptPath } : {}) })
  try {
    const root = realpathSync.native(projectDir)
    const cache = resolve(options.cacheDir ?? join(root, '.yoke', 'npm-download-cache'))
    safePaths(root, cache)
    const inputs = inputBytes(root)
    receiptPath = join(root, 'node_modules', RECEIPT)
    let previous
    if (existsSync(receiptPath)) {
      if (!lstatSync(receiptPath).isFile() || lstatSync(receiptPath).size > 16384) throw problem('unsafe-path')
      try { previous = JSON.parse(readFileSync(receiptPath, 'utf8')) } catch { /* invalid receipts are not reusable */ }
      unlinkSync(receiptPath)
    }
    const timeoutMs = Math.min(600000, Math.max(1, options.timeoutMs ?? 120000))
    const npm = options.npm ?? defaultNpm(), env = options.env ?? process.env
    const version = await runNpm(npm, ['--version'], root, env, timeoutMs)
    if (version.status !== 0 || version.timedOut || version.captureExceeded) return finish({ status: 'failed', failure: npmFailure(version) })
    const npmVersion = version.stdout.trim()
    if (!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(npmVersion) || npmVersion.length > 64) return finish({ status: 'failed', failure: { kind: 'unknown', causeCode: 'NPM_VERSION_UNVERIFIED' } })
    const args = ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--json', '--fetch-retries=0', '--cache', cache, ...(options.offline ? ['--offline'] : [])]
    const identity = { inputs, nodeVersion: process.version, platform: process.platform, arch: process.arch, npmVersion, args }
    fingerprint = sha256(JSON.stringify(identity))
    safePaths(root, cache)
    if (JSON.stringify(inputBytes(root)) !== JSON.stringify(inputs)) return finish({ status: 'failed', failure: { kind: 'inputs-changed' } })
    const localInstall = existsSync(join(root, 'node_modules')) && readdirSync(join(root, 'node_modules')).length > 0
    const matching = previous?.version === 1 && previous.status === 'installed' && previous.fingerprint === fingerprint && sha256(JSON.stringify(previous.identity)) === fingerprint
    if (options.reuse !== false && matching && localInstall) {
      writeFileSync(receiptPath, JSON.stringify(previous)+'\n', { flag: 'wx', mode: 0o600 })
      return finish({ status: 'reused' })
    }
    mkdirSync(cache, { recursive: true })
    const install = await runNpm(npm, args, root, env, timeoutMs)
    if (install.status !== 0 || install.timedOut || install.captureExceeded) return finish({ status: 'failed', failure: npmFailure(install) })
    safePaths(root, cache)
    if (JSON.stringify(inputBytes(root)) !== JSON.stringify(inputs)) return finish({ status: 'failed', failure: { kind: 'inputs-changed' } })
    mkdirSync(join(root, 'node_modules'), { recursive: true })
    // npm need not create node_modules for a package with no dependencies.
    if (readdirSync(join(root, 'node_modules')).length === 0) writeFileSync(join(root, 'node_modules', '.yoke-empty-install'), fingerprint, { flag: 'wx', mode: 0o600 })
    const receipt = { version: 1, status: 'installed', fingerprint, identity, durationMs: performance.now() - started }
    writeFileSync(receiptPath, JSON.stringify(receipt)+'\n', { flag: 'wx', mode: 0o600 })
    return finish({ status: 'installed' })
  } catch (error) {
    // Failure receipts never certify readiness; raw stderr, environment and errors stay private.
    return finish({ status: 'failed', failure: { kind: error.setupKind ?? 'unknown' } })
  }
}
