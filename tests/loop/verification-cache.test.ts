import { afterEach, beforeEach, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commandVerifier } from '../../src/loop/verify.js'
let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'yoke-check-session-')); writeFileSync(join(root, 'source.ts'), 'original') })
afterEach(() => rmSync(root, { recursive: true, force: true }))
async function api() {
  expect(existsSync('src/loop/verification-cache.ts'), 'Conservative verification session exists').toBe(true)
  const path = '../../src/loop/verification-cache'
  return await import(/* @vite-ignore */ path)
}
it('reuses only successful identical immutable commands within the same session', async () => {
  const { createVerificationSession } = await api()
  const session = createVerificationSession()
  let executions = 0
  const execute = () => { executions++; return { passed: true, summary: 'passed' } }
  session.run(root, 'test', 'criterion', execute)
  session.run(root, 'test', 'criterion', execute)
  expect(executions).toBe(1)
  expect(session.stats()).toEqual({ executed: 1, reused: 1 })
})
it('invalidates on source, environment, phase and contract changes', async () => {
  const { createVerificationSession } = await api()
  const session = createVerificationSession()
  let executions = 0
  const execute = () => { executions++; return { passed: true, summary: 'passed' } }
  session.run(root, 'test', 'criterion', execute, { env: { PATH: 'one' } })
  session.run(root, 'test', 'criterion', execute, { env: { PATH: 'two' } })
  session.run(root, 'test', 'verify', execute, { env: { PATH: 'two' } })
  writeFileSync(join(root, 'source.ts'), 'changed')
  session.run(root, 'test', 'verify', execute, { env: { PATH: 'two' } })
  mkdirSync(join(root, '.yoke'))
  writeFileSync(join(root, '.yoke/requirements.yaml'), 'new approved requirements')
  session.run(root, 'test', 'verify', execute, { env: { PATH: 'two' } })
  expect(executions).toBe(5)
})
it('never reuses a failure or a successful command that changed checked files', async () => {
  const { createVerificationSession } = await api()
  const session = createVerificationSession()
  let failures = 0
  const fail = () => { failures++; return { passed: false, summary: 'failed' } }
  session.run(root, 'fail', 'criterion', fail); session.run(root, 'fail', 'criterion', fail)
  expect(failures).toBe(2)
  let mutations = 0
  const mutate = () => { mutations++; writeFileSync(join(root, 'source.ts'), `changed ${mutations}`); return { passed: true, summary: 'passed' } }
  session.run(root, 'mutate', 'criterion', mutate); session.run(root, 'mutate', 'criterion', mutate)
  expect(mutations).toBe(2)
})
it('starts fresh for integration/completion and binds installed dependencies', async () => {
  const { createVerificationSession } = await api()
  const session = createVerificationSession()
  let executions = 0
  const execute = () => { executions++; return { passed: true, summary: 'passed' } }
  session.run(root, 'test', 'criterion', execute)
  createVerificationSession().run(root, 'test', 'criterion', execute)
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  writeFileSync(join(root, 'node_modules/tool.js'), 'one')
  session.run(root, 'test', 'criterion', execute)
  writeFileSync(join(root, 'node_modules/tool.js'), 'two')
  session.run(root, 'test', 'criterion', execute)
  expect(executions).toBe(4)
})
it('does not cache completion/integration or failed identities', async () => {
  const { createVerificationSession } = await api()
  let executions = 0
  const execute = () => { executions++; return { passed: true, summary: 'passed' } }
  const session = createVerificationSession()
  session.run(root, 'test', 'completion', execute); session.run(root, 'test', 'completion', execute)
  session.run(root, 'test', 'integration', execute); session.run(root, 'test', 'integration', execute)
  const missing = join(root, 'missing')
  session.run(missing, 'test', 'criterion', execute); session.run(missing, 'test', 'criterion', execute)
  expect(executions).toBe(6)
})
it('wires an explicitly approved immutable command into the verifier without caching other commands', async () => {
  const { createVerificationSession } = await api()
  const session = createVerificationSession()
  const command = 'node -e "process.exit(0)"'
  const verify = commandVerifier(command, { session, reusableCommands: [command], phase: 'criterion' })
  expect(verify(root).passed).toBe(true)
  expect(verify(root).passed).toBe(true)
  expect(session.stats()).toEqual({ executed: 1, reused: 1 })
  commandVerifier(command, { session, reusableCommands: [], phase: 'criterion' })(root)
  expect(session.stats()).toEqual({ executed: 1, reused: 1 })
})
it('invalidates ignored local inputs rather than treating a clean git tree as unchanged', async () => {
  const { execFileSync } = await import('node:child_process')
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  writeFileSync(join(root, '.gitignore'), 'ignored.txt\n')
  writeFileSync(join(root, 'ignored.txt'), 'first')
  const { createVerificationSession } = await api()
  const session = createVerificationSession()
  let executions = 0
  const execute = () => { executions++; return { passed: true, summary: 'passed' } }
  session.run(root, 'reads ignored.txt', 'criterion', execute)
  writeFileSync(join(root, 'ignored.txt'), 'changed')
  session.run(root, 'reads ignored.txt', 'criterion', execute)
  expect(executions).toBe(2)
})
it('frames ignored file boundaries so moving path-shaped bytes cannot preserve identity', async () => {
  const { execFileSync } = await import('node:child_process')
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  writeFileSync(join(root, '.gitignore'), 'a.txt\nb.txt\n')
  const second = join(root, 'b.txt')
  writeFileSync(join(root, 'a.txt'), 'x')
  writeFileSync(second, `y${second}z`)
  const { createVerificationSession } = await api()
  const session = createVerificationSession()
  let executions = 0
  const execute = () => { executions++; return { passed: true, summary: 'passed' } }
  session.run(root, 'reads ignored inputs', 'criterion', execute)
  writeFileSync(join(root, 'a.txt'), `x${second}y`)
  writeFileSync(second, 'z')
  session.run(root, 'reads ignored inputs', 'criterion', execute)
  expect(executions).toBe(2)
})

it('rejects an oversized tree before reading workspace content or the Node executable', async () => {
  const { createVerificationSession } = await api(), notices: unknown[] = []
  const session = createVerificationSession({ onDiagnostic: (notice: unknown) => notices.push(notice) })
  const large = join(root, 'large.bin')
  writeFileSync(large, ''); truncateSync(large, 65 * 1024 * 1024)
  let executions = 0
  const execute = () => { executions++; return { passed: true, summary: 'passed' } }
  session.run(root, 'check', 'criterion', execute); session.run(root, 'check', 'criterion', execute)
  expect(executions).toBe(2)
  expect(session.diagnostics()).toMatchObject({ identityChecks: 2, workspaceFilesHashed: 0, workspaceBytesHashed: 0, runtimeBytesHashed: 0, skipped: { byte_limit: 2 } })
  expect(notices).toHaveLength(1)
})

it('reads each workspace file only once per identity and includes executable permissions', async () => {
  const { createVerificationSession } = await api(), session = createVerificationSession()
  const execute = () => ({ passed: true, summary: 'passed' })
  session.run(root, 'check', 'criterion', execute)
  session.run(root, 'check', 'criterion', execute)
  expect(session.stats()).toEqual({ executed: 1, reused: 1 })
  expect(session.diagnostics()).toMatchObject({ identityChecks: 3, workspaceFilesHashed: 3, workspaceBytesHashed: 3 * Buffer.byteLength('original') })
  if (process.platform !== 'win32') {
    chmodSync(join(root, 'source.ts'), 0o755)
    session.run(root, 'check', 'criterion', execute)
    expect(session.stats().executed).toBe(2)
  }
})

it('reports linked inputs and successful input mutations without caching them', async () => {
  const { createVerificationSession } = await api(), session = createVerificationSession()
  session.run(root, 'mutate', 'criterion', () => { writeFileSync(join(root, 'source.ts'), 'different'); return { passed: true, summary: 'passed' } })
  expect(session.diagnostics().skipped.mutating_command).toBe(1)
  if (process.platform !== 'win32') {
    symlinkSync(join(root, 'source.ts'), join(root, 'linked'))
    session.run(root, 'check', 'criterion', () => ({ passed: true, summary: 'passed' }))
    expect(session.diagnostics().lastSkip?.reason).toBe('linked_input')
  }
})

it('binds Git HEAD even when a new commit has exactly the same working tree', async () => {
  const { execFileSync } = await import('node:child_process')
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  execFileSync('git', ['add', '.'], { cwd: root })
  const gitCommit = (message: string) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', message], { cwd: root })
  gitCommit('initial')
  const { createVerificationSession } = await api(), session = createVerificationSession()
  const execute = () => ({ passed: true, summary: 'passed' })
  session.run(root, 'reads git head', 'criterion', execute)
  gitCommit('empty commit')
  session.run(root, 'reads git head', 'criterion', execute)
  expect(session.stats().executed).toBe(2)
})

it('requires an explicit complete input declaration to avoid unrelated runtime-state invalidation', async () => {
  const { createVerificationSession } = await api()
  mkdirSync(join(root, '.yoke'))
  writeFileSync(join(root, '.yoke/status.json'), 'first')
  writeFileSync(join(root, '.yoke/requirements.yaml'), 'approved')
  const session = createVerificationSession({ inputPaths: ['source.ts'] })
  const execute = () => ({ passed: true, summary: 'passed' })
  session.run(root, 'check', 'criterion', execute)
  writeFileSync(join(root, '.yoke/status.json'), 'later')
  session.run(root, 'check', 'criterion', execute)
  expect(session.stats()).toEqual({ executed: 1, reused: 1 })
  writeFileSync(join(root, '.yoke/requirements.yaml'), 'changed approval')
  session.run(root, 'check', 'criterion', execute)
  expect(session.stats().executed).toBe(2)
  writeFileSync(join(root, 'source.ts'), 'changed source')
  session.run(root, 'check', 'criterion', execute)
  expect(session.stats().executed).toBe(3)
})

it.each([[], ['../outside'], ['/tmp'], ['src/**/*.ts'], ['missing'], Array.from({ length: 257 }, () => 'source.ts')].map(inputPaths => ({ inputPaths })))('disables reuse for invalid declared inputs $inputPaths', async ({ inputPaths }) => {
  const { createVerificationSession } = await api(), session = createVerificationSession({ inputPaths })
  const execute = () => ({ passed: true, summary: 'passed' })
  session.run(root, 'check', 'criterion', execute); session.run(root, 'check', 'criterion', execute)
  expect(session.stats()).toEqual({ executed: 2, reused: 0 })
  expect(session.diagnostics()).toMatchObject({ runtimeBytesHashed: 0, workspaceBytesHashed: 0, skipped: { invalid_inputs: 2 } })
})

it.skipIf(process.platform === 'win32')('refuses a declared file behind a symlink ancestor', async () => {
  const { createVerificationSession } = await api()
  mkdirSync(join(root, 'actual')); writeFileSync(join(root, 'actual/input.ts'), 'input')
  symlinkSync(join(root, 'actual'), join(root, 'alias'))
  const session = createVerificationSession({ inputPaths: ['alias/input.ts'] })
  session.run(root, 'check', 'criterion', () => ({ passed: true, summary: 'passed' }))
  expect(session.diagnostics()).toMatchObject({ runtimeBytesHashed: 0, workspaceBytesHashed: 0, skipped: { linked_input: 1 } })
})

it('keeps declared dependencies, environment and policy in the reuse identity', async () => {
  const { createVerificationSession } = await api()
  mkdirSync(join(root, 'node_modules')); writeFileSync(join(root, 'node_modules/tool.js'), 'one')
  const session = createVerificationSession({ inputPaths: ['source.ts', 'node_modules'] }), execute = () => ({ passed: true, summary: 'passed' })
  session.run(root, 'check', 'verify', execute, { env: { FLAG: 'one' }, policyKey: 'one' })
  writeFileSync(join(root, 'node_modules/tool.js'), 'two')
  session.run(root, 'check', 'verify', execute, { env: { FLAG: 'one' }, policyKey: 'one' })
  session.run(root, 'check', 'verify', execute, { env: { FLAG: 'two' }, policyKey: 'one' })
  session.run(root, 'check', 'verify', execute, { env: { FLAG: 'two' }, policyKey: 'two' })
  expect(session.stats()).toEqual({ executed: 4, reused: 0 })
})
