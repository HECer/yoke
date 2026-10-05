import { afterEach, beforeEach, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
