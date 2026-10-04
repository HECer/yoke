import { afterEach, expect, it, vi } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const roots: string[] = []
afterEach(() => { vi.unstubAllEnvs(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })) })
function directory() { const root = mkdtempSync(join(tmpdir(), 'yoke-npm-setup-')); roots.push(root); return root }
function fixture() {
  const root = directory(), tool = join(directory(), 'npm-fixture.mjs')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'setup-fixture', version: '1.0.0' }))
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ name: 'setup-fixture', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'setup-fixture', version: '1.0.0' } } }))
  writeFileSync(tool, `import {appendFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
const rawArgs=process.argv.slice(2); appendFileSync('npm-calls.log', JSON.stringify(rawArgs)+'\\n'); const args=rawArgs.filter(arg=>arg!=='--omit=dev'&&!arg.startsWith('--auth-token='));
if(args[0]==='--version') { if(process.env.TEST_MUTATE_VERSION) writeFileSync('package-lock.json', readFileSync('package-lock.json','utf8')+' '); console.log(process.env.TEST_NPM_VERSION??'10.9.3'); }
else if(args[0]==='ci') {
 if(process.env.TEST_MUTATE_INPUT) writeFileSync('package-lock.json', readFileSync('package-lock.json','utf8')+' ');
 if(process.env.TEST_NPM_CAUSE) { console.error(JSON.stringify({error:{code:process.env.TEST_NPM_CAUSE,summary:'secret-token-do-not-copy',detail:'https://user:password@registry.example'}})); process.exit(1); }
 if(process.env.TEST_NPM_DELAY) await new Promise(resolve=>setTimeout(resolve,10000));
 mkdirSync('node_modules', {recursive:true}); writeFileSync('node_modules/package.txt', rawArgs.includes('--omit=dev')?'installed without dev':'installed');
} else process.exit(2);
`)
  const npm = { command: process.execPath, args: [tool] }
  return { root, npm, options: { npm, timeoutMs: 5000 }, calls: () => existsSync(join(root, 'npm-calls.log')) ? readFileSync(join(root, 'npm-calls.log'), 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [] }
}
async function setup(root: string, options: any = {}) {
  const path = pathToFileURL(resolve('bench/dependency-setup.mjs')).href
  const module = await import(/* @vite-ignore */ path).catch(() => ({}))
  expect(module.setupNpmDependencies).toBeTypeOf('function')
  return module.setupNpmDependencies(root, options)
}

it('installs locally with bounded npm arguments and reuses only a matching successful receipt', async () => {
  const f = fixture(), packageBytes = readFileSync(join(f.root, 'package.json')), lockBytes = readFileSync(join(f.root, 'package-lock.json'))
  const result = await setup(f.root, f.options)
  expect(result).toMatchObject({ status: 'installed' }); expect(result.durationMs).toBeGreaterThanOrEqual(0)
  const receipt = JSON.parse(readFileSync(result.receiptPath, 'utf8'))
  expect(receipt).toMatchObject({ version: 1, status: 'installed', fingerprint: result.fingerprint, identity: { npmVersion: '10.9.3', nodeVersion: process.version, platform: process.platform, arch: process.arch } })
  expect(f.calls()[1]).toEqual(['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--json', '--fetch-retries=0', '--cache', join(realpathSync.native(f.root), '.yoke', 'npm-download-cache')])
  const reused = await setup(f.root, f.options)
  expect(reused).toMatchObject({ status: 'reused', fingerprint: result.fingerprint })
  expect(f.calls().filter(args => args[0] === 'ci')).toHaveLength(1)
  expect(readFileSync(join(f.root, 'package.json'))).toEqual(packageBytes)
  expect(readFileSync(join(f.root, 'package-lock.json'))).toEqual(lockBytes)
})

it('uses canonical local paths and reuses the same install through a project directory alias', async () => {
  const f = fixture(), alias = join(directory(), 'project alias')
  symlinkSync(f.root, alias, 'junction')
  const canonicalRoot = realpathSync.native(alias)
  expect(alias).not.toBe(canonicalRoot)
  const installed = await setup(alias, f.options)
  expect(installed.status).toBe('installed')
  expect(f.calls()[1]).toEqual(['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--json', '--fetch-retries=0', '--cache', join(canonicalRoot, '.yoke', 'npm-download-cache')])
  expect(installed.receiptPath).toBe(join(canonicalRoot, 'node_modules', '.yoke-dependency-setup.json'))
  expect(await setup(f.root, f.options)).toMatchObject({ status: 'reused', fingerprint: installed.fingerprint, receiptPath: installed.receiptPath })
  expect(f.calls().filter(args => args[0] === 'ci')).toHaveLength(1)
})

it('resolves npm_execpath with spaces through Node argv without a platform shell', async () => {
  const f = fixture(), tools = join(directory(), 'npm with spaces'); mkdirSync(tools)
  const cli = join(tools, 'npm-cli.js'); copyFileSync(f.npm.args[0], cli); writeFileSync(join(tools, 'package.json'), JSON.stringify({ type: 'module' }))
  vi.stubEnv('npm_execpath', cli)
  expect((await setup(f.root, { offline: true, timeoutMs: 5000 })).status).toBe('installed')
  expect(f.calls()[0]).toEqual(['--version'])
  expect(f.calls()[1]).toContain('--offline')
})

it.each(['node_modules/npm/bin/npm-cli.js', 'npm/bin/npm-cli.js'])('discovers a PATH-only npm.cmd beside %s without invoking the shim', async relativeCli => {
  const pathDir = join(directory(), 'npm shim with spaces'), nodeExecutable = join(directory(), 'unbundled-node')
  const cli = join(pathDir, relativeCli); mkdirSync(dirname(cli), { recursive: true }); writeFileSync(cli, '// npm CLI fixture')
  writeFileSync(join(pathDir, 'npm.cmd'), '@echo off\nexit /b 99\n')
  const module = await import(/* @vite-ignore */ pathToFileURL(resolve('bench/dependency-setup.mjs')).href)
  expect(module.resolveNpmInvocation).toBeTypeOf('function')
  expect(module.resolveNpmInvocation({ PATH: [directory(), pathDir].join(delimiter) }, nodeExecutable)).toEqual({ command: nodeExecutable, args: [cli] })
})

it.each(['package.json', 'package-lock.json'])('invalidates installation reuse when %s changes', async input => {
  const f = fixture(), original = await setup(f.root, f.options)
  writeFileSync(join(f.root, input), readFileSync(join(f.root, input), 'utf8')+'\n')
  const changed = await setup(f.root, f.options)
  expect(changed.status).toBe('installed'); expect(changed.fingerprint).not.toBe(original.fingerprint)
  expect(f.calls().filter(args => args[0] === 'ci')).toHaveLength(2)
})

it('rejects a deleted lockfile before invoking npm or reusing an old receipt', async () => {
  const f = fixture(); await setup(f.root, f.options); const calls = f.calls().length
  rmSync(join(f.root, 'package-lock.json'))
  expect(await setup(f.root, f.options)).toMatchObject({ status: 'failed', failure: { kind: 'invalid-input' } })
  expect(f.calls()).toHaveLength(calls)
})

it.each(['deleted', 'corrupt'])('invalidates a successful receipt after failed setup with a %s lockfile even if its original bytes return', async state => {
  const f = fixture(), lock = join(f.root, 'package-lock.json'), original = readFileSync(lock), first = await setup(f.root, f.options)
  if (state === 'deleted') rmSync(lock)
  else writeFileSync(lock, 'invalid-json')
  expect(await setup(f.root, f.options)).toMatchObject({ status: 'failed', failure: { kind: 'invalid-input' } })
  expect(existsSync(first.receiptPath)).toBe(false)
  writeFileSync(lock, original)
  expect((await setup(f.root, f.options)).status).toBe('installed')
  expect(f.calls().filter(args => args[0] === 'ci')).toHaveLength(2)
})

it('invalidates reuse after npm version, install arguments or recorded environment change', async () => {
  const f = fixture(); const installed = await setup(f.root, f.options)
  const receipt = JSON.parse(readFileSync(installed.receiptPath, 'utf8')); receipt.identity.nodeVersion='v0.0.0'; writeFileSync(installed.receiptPath, JSON.stringify(receipt))
  expect((await setup(f.root, f.options)).status).toBe('installed')
  expect((await setup(f.root, { ...f.options, env: { ...process.env, TEST_NPM_VERSION: '11.0.0' } })).status).toBe('installed')
  expect((await setup(f.root, { ...f.options, offline: true })).status).toBe('installed')
  expect(f.calls().at(-1)).toContain('--offline')
  expect(f.calls().filter(args => args[0] === 'ci')).toHaveLength(4)
})

it.each(['command', 'prefix'])('invalidates reuse when the actual npm invocation %s changes at the same npm version', async change => {
  const f = fixture(), first = await setup(f.root, f.options)
  let npm
  if (change === 'prefix') npm = { ...f.npm, args: [...f.npm.args, '--omit=dev'] }
  else {
    const alias = join(directory(), process.platform === 'win32' ? 'node-alias.exe' : 'node-alias')
    symlinkSync(process.execPath, alias)
    npm = { ...f.npm, command: alias }
  }
  const second = await setup(f.root, { ...f.options, npm })
  expect(second.status).toBe('installed'); expect(second.fingerprint).not.toBe(first.fingerprint)
  expect(f.calls().filter(args => args.includes('ci'))).toHaveLength(2)
  const receipt = JSON.parse(readFileSync(second.receiptPath, 'utf8'))
  expect(receipt.identity.invocation).toEqual({ commandHash: createHash('sha256').update(npm.command).digest('hex'), prefixArgsHash: createHash('sha256').update(JSON.stringify(npm.args)).digest('hex') })
  if (change === 'prefix') expect(readFileSync(join(f.root, 'node_modules/package.txt'), 'utf8')).toBe('installed without dev')
})

it('binds arbitrary trusted npm prefixes without persisting their secrets in a receipt', async () => {
  const f = fixture(), prefix = [...f.npm.args, '--auth-token=secret-prefix-do-not-record']
  const result = await setup(f.root, { ...f.options, npm: { ...f.npm, args: prefix } })
  expect(result.status).toBe('installed')
  expect(readFileSync(result.receiptPath, 'utf8')).not.toContain('secret-prefix-do-not-record')
})

it('does not reuse a receipt without a present installation', async () => {
  const f = fixture(); const first = await setup(f.root, f.options)
  const receipt = readFileSync(first.receiptPath)
  rmSync(join(f.root, 'node_modules'), { recursive: true }); mkdirSync(join(f.root, 'node_modules')); writeFileSync(first.receiptPath, receipt)
  expect((await setup(f.root, f.options)).status).toBe('installed')
  expect(f.calls().filter(args => args[0] === 'ci')).toHaveLength(2)
})

it.each([['ENOCACHE','offline-cache-miss'], ['ENOTFOUND','network'], ['ECONNRESET','network'], ['E401','authentication'], ['E403','authentication'], ['ELIFECYCLE','unknown'], ['UNRECOGNIZED_SECRET','unknown']])('classifies structured npm %s safely as %s', async (code, kind) => {
  const f = fixture()
  const result = await setup(f.root, { ...f.options, env: { ...process.env, TEST_NPM_CAUSE: code, SECRET_TEST: 'secret-environment-do-not-copy' } })
  expect(result).toMatchObject({ status: 'failed', failure: { kind } })
  expect(f.calls().filter(args => args[0] === 'ci')).toHaveLength(1)
  expect(JSON.stringify(result)).not.toMatch(/secret|password|registry\.example|UNRECOGNIZED_SECRET/)
  expect(existsSync(join(f.root, 'node_modules', '.yoke-dependency-setup.json'))).toBe(false)
})

it('invalidates old successful receipts before a failed reinstall', async () => {
  const f = fixture(); const first = await setup(f.root, f.options)
  expect((await setup(f.root, { ...f.options, reuse: false, env: { ...process.env, TEST_NPM_CAUSE: 'ENOCACHE' } })).status).toBe('failed')
  expect(existsSync(first.receiptPath)).toBe(false)
  expect((await setup(f.root, f.options)).status).toBe('installed')
})

it('distinguishes spawn failure from timeout without copying process error messages', async () => {
  const f = fixture()
  expect(await setup(f.root, { npm: { command: 'yoke-missing-npm-fixture', args: [] } })).toMatchObject({ status: 'failed', failure: { kind: 'spawn', causeCode: 'ENOENT' } })
  expect(await setup(f.root, { ...f.options, timeoutMs: 100, env: { ...process.env, TEST_NPM_DELAY: '1' } })).toMatchObject({ status: 'failed', failure: { kind: 'timeout' } })
})

it('refuses a successful receipt when npm changes package inputs and preserves the changed bytes', async () => {
  const f = fixture(), before = readFileSync(join(f.root, 'package-lock.json'), 'utf8')
  expect(await setup(f.root, { ...f.options, env: { ...process.env, TEST_MUTATE_INPUT: '1' } })).toMatchObject({ status: 'failed', failure: { kind: 'inputs-changed' } })
  expect(readFileSync(join(f.root, 'package-lock.json'), 'utf8')).toBe(before+' ')
  expect(existsSync(join(f.root, 'node_modules', '.yoke-dependency-setup.json'))).toBe(false)
})

it('refuses reuse when package inputs change during the npm version probe', async () => {
  const f = fixture(); const first = await setup(f.root, f.options)
  expect(await setup(f.root, { ...f.options, env: { ...process.env, TEST_MUTATE_VERSION: '1' } })).toMatchObject({ status: 'failed', failure: { kind: 'inputs-changed' } })
  expect(existsSync(first.receiptPath)).toBe(false)
  expect(f.calls().filter(args => args[0] === 'ci')).toHaveLength(1)
})

it.each(['node_modules', '.yoke', '.cache', '.vite', '.vite-temp'])('rejects a linked writable %s before invoking npm', async path => {
  const f = fixture(), outside = directory()
  symlinkSync(outside, join(f.root, path), 'junction')
  expect(await setup(f.root, f.options)).toMatchObject({ status: 'failed', failure: { kind: 'unsafe-path' } })
  expect(f.calls()).toEqual([])
})

it('invalidates its safely owned receipt on a cache-boundary failure while preserving the linked target', async () => {
  const f = fixture(), first = await setup(f.root, f.options), outside = directory()
  writeFileSync(join(outside, 'keep.txt'), 'KEEP'); symlinkSync(outside, join(f.root, '.cache'), 'junction')
  expect(await setup(f.root, f.options)).toMatchObject({ status: 'failed', failure: { kind: 'unsafe-path' } })
  expect(existsSync(first.receiptPath)).toBe(false)
  expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('KEEP')
})

it.each(['package.json', 'package-lock.json', 'receipt'])('rejects linked %s without modifying its target', async input => {
  const f = fixture(), outside = directory()
  if (input === 'receipt') {
    const installed = await setup(f.root, f.options); rmSync(installed.receiptPath)
    writeFileSync(join(outside, 'outside.json'), 'KEEP'); symlinkSync(join(outside, 'outside.json'), installed.receiptPath)
  } else {
    const source = readFileSync(join(f.root, input)); rmSync(join(f.root, input)); writeFileSync(join(outside, 'outside.json'), source); symlinkSync(join(outside, 'outside.json'), join(f.root, input))
  }
  const bytes = readFileSync(join(outside, 'outside.json')), calls = f.calls().length
  expect(await setup(f.root, f.options)).toMatchObject({ status: 'failed', failure: { kind: 'unsafe-path' } })
  expect(readFileSync(join(outside, 'outside.json'))).toEqual(bytes); expect(f.calls()).toHaveLength(calls)
})

it('permits an explicit shared download cache but rejects a linked cache path', async () => {
  const f = fixture(), shared = directory()
  expect((await setup(f.root, { ...f.options, cacheDir: shared })).status).toBe('installed')
  const linked = join(directory(), 'cache'); symlinkSync(shared, linked, 'junction')
  expect(await setup(f.root, { ...f.options, cacheDir: linked })).toMatchObject({ status: 'failed', failure: { kind: 'unsafe-path' } })
})

it('stops run-large before model dispatch when copied package inputs are invalid', () => {
  const seed = directory(), runs = directory(), root = resolve('.')
  writeFileSync(join(seed, 'package.json'), JSON.stringify({ name: 'invalid-seed' }))
  const result = spawnSync(process.execPath, [join(root, 'bench/run-large.mjs'), `--seed=${seed}`, '--routing=off', `--run-root=${runs}`], { cwd: root, encoding: 'utf8', env: { ...process.env, YOKE_NO_UPDATE_CHECK: '1' }, timeout: 10000 })
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('dependency setup failed')
  expect(result.stderr).not.toContain('[bench-large] routing=')
})
