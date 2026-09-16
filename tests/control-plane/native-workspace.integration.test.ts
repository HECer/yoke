import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync, chmodSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { runLoopCommand } from '../../src/loop/run-command.js'
import { saveConfig } from '../../src/retrofit/config.js'
import { savePrd, loadPrd, storyPathSegment, type Story } from '../../src/loop/prd.js'
import { realGitOps } from '../../src/loop/git.js'
import { acquireLock, readLock, releaseLock } from '../../src/loop/lock.js'
import { initializeLedger, readLedger, transactLedger } from '../../src/control-plane/store.js'
import { reserveBudget, settleBudget } from '../../src/control-plane/budget.js'
import { contentDigest } from '../../src/control-plane/workspace-snapshot.js'
import { NativeWorkspaceActionSchema, runNativeWorkspaceAction, type NativeWorkspaceAction } from '../../src/control-plane/native-action.js'
import { makeActionRunner } from '../../src/execution/actions.js'
import { prepareIsolatedWorktree } from '../../src/loop/recovery.js'
import { protectAcceptance } from '../../src/check/command.js'
import { main } from '../../src/control-plane/cli.js'

let root: string, state: string
const prdPath = () => join(root, '.yoke/prd.yaml')
const text = (path: string, directory = root) => readFileSync(join(directory, path), 'utf8')
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const action = (patch: Partial<NativeWorkspaceAction> = {}): NativeWorkspaceAction => ({ kind: 'workspace-edit', storyId: 'S1', writeScopes: ['src'], edits: [{ path: 'src/value.txt', expectedSha256: contentDigest('before\n'), content: 'after\n' }], reserveComputeMs: 1000, ...patch })
const story = (patch: Partial<Story> = {}): Story => ({ id: 'S1', title: 'Update value', priority: 1, passes: false, writes: ['src'], acceptance: ['value changes to after'], ...patch })
function configure(change = action(), item = story()) {
  saveConfig(root, { canonVersion: '0.1.0', agents: ['codex'], loop: { enabled: true, isolate: true }, actions: [change], verify: { command: 'node tests/gate.cjs', retries: 1 } })
  savePrd(prdPath(), [item]); git('add', '-A'); git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'configure managed task')
}
function initialize(computeMs = 60000) { initializeLedger(root, { tokens: 0, costMicrousd: 0, computeMs, maxActive: 1 }) }
function run(options: Partial<Parameters<typeof runLoopCommand>[1]> = {}) {
  return runLoopCommand(root, { maxIterations: 1, parallel: 1, isAvailable: () => false, review: false, routing: false, ...options })
}
function journals() {
  const dir = join(root, '.yoke/control-plane/native')
  return existsSync(dir) ? readdirSync(dir).filter(p => p.endsWith('.json')).map(p => JSON.parse(text(`.yoke/control-plane/native/${p}`))) : []
}
function direct(change = action(), item = story()) {
  const token = acquireLock(root).ownerToken!
  const candidate = join(root, '.yoke/worktrees', storyPathSegment('S1'))
  prepareIsolatedWorktree(root, candidate, false)
  return { token, candidate, invoke: () => runNativeWorkspaceAction({ targetDir: candidate, story: item }, change, { projectRoot: root, ownerToken: token, protectedScopes: ['tests/gate.cjs'] }) }
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'yoke-native-integration-')); state = mkdtempSync(join(tmpdir(), 'yoke-native-state-'))
  vi.stubEnv('YOKE_STATE_DIR', state)
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {})
  git('init', '-q'); git('config', 'user.name', 'Yoke Test'); git('config', 'user.email', 'test@yoke.local'); git('config', 'core.autocrlf', 'false')
  for (const dir of ['src', 'tests', '.yoke']) mkdirSync(join(root, dir))
  writeFileSync(join(root, '.gitignore'), '.yoke/worktrees/\n.yoke/loop.log\n')
  writeFileSync(join(root, 'src/value.txt'), 'before\n')
  writeFileSync(join(root, 'tests/gate.cjs'), "require('node:assert/strict').equal(require('node:fs').readFileSync('src/value.txt','utf8'),'after\\n')\n")
  writeFileSync(join(root, '.yoke/acceptance.yaml'), 'version: 1\ncriteria:\n  - id: updated-value\n    text: Value is after\n    commands: [node tests/gate.cjs]\nprotected: [tests/gate.cjs]\n')
  configure(); protectAcceptance(root)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); rmSync(state, { recursive: true, force: true }) })

it('executes native edits in a real owned worktree, passes a real process gate and lands only source plus loop state', () => {
  initialize(); const beforeHead = git('rev-parse', 'HEAD')
  const code = run(); expect(code, JSON.stringify([...vi.mocked(console.log).mock.calls,...vi.mocked(console.error).mock.calls, git('status', '--porcelain', '--untracked-files=all')])).toBe(0)
  expect(text('src/value.txt')).toBe('after\n'); expect(git('rev-parse', 'HEAD')).not.toBe(beforeHead)
  expect(loadPrd(prdPath())[0].passes).toBe(true)
  expect(existsSync(join(root, '.yoke/worktrees', storyPathSegment('S1')))).toBe(false)
  const ledger = readLedger(root)!
  expect(ledger.revision).toBe(2); expect(ledger.ledger.reservations).toHaveLength(1)
  expect(ledger.ledger.reservations[0].usage).toMatchObject({ tokens: 0, costMicrousd: 0, computeMs: expect.any(Number) })
  expect(journals()[0]).toMatchObject({ phase: 'applied', runtime: 'native-text-broker-v1', boundary: 'broker-operations-only', acceptance: 'pending-existing-loop-gates', candidateFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) })
  expect(git('show', '--name-only', '--format=', 'HEAD')).not.toContain('control-plane')
  expect(git('ls-files', '.yoke/control-plane')).toBe(''); expect(readLock(root)).toBeNull()
})
it('keeps the target unchanged while testing the candidate', () => {
  initialize(); let checks = 0
  expect(run({ verify: candidate => {
    checks++; expect(candidate).not.toBe(root); expect(text('src/value.txt')).toBe('before\n')
    expect(text('src/value.txt', candidate)).toBe('after\n')
    expect(readLedger(root)!.ledger.reservations[0].usage).not.toBeNull()
    return { passed: true, summary: 'candidate verified' }
  } })).toBe(0)
  expect(checks).toBe(1)
})
it('failing gates retain the owned candidate and never land a claimed success', () => {
  initialize(); const head = git('rev-parse', 'HEAD')
  expect(run({ verify: () => ({ passed: false, summary: 'not accepted' }) })).toBe(1)
  expect(git('rev-parse', 'HEAD')).toBe(head); expect(text('src/value.txt')).toBe('before\n')
  expect(text('src/value.txt', join(root, '.yoke/worktrees', storyPathSegment('S1')))).toBe('after\n')
  expect(loadPrd(prdPath())[0].passes).toBe(false)
})
it('blocks source-mutating tests even when they return green', () => {
  initialize()
  expect(run({ verify: candidate => {
    writeFileSync(join(candidate, 'src/value.txt'), 'unverified second edit\n')
    return { passed: true, summary: 'green but changed' }
  } })).toBe(1)
  expect(text('src/value.txt')).toBe('before\n'); expect(loadPrd(prdPath())[0].passes).toBe(false)
})
it('rejects changes outside the explicit edit set during gates as well', () => {
  initialize()
  expect(run({ verify: candidate => {
    writeFileSync(join(candidate, 'unrelated.txt'), 'not checked')
    return { passed: true, summary: 'green' }
  } })).toBe(1)
  expect(existsSync(join(root, 'unrelated.txt'))).toBe(false)
})
it('checks stability after the independent reviewer, not just after the first test', () => {
  initialize()
  expect(run({ reviewRunner: ctx => {
    writeFileSync(join(ctx.targetDir, 'src/value.txt'), 'review mutated source')
    return { success: true, summary: 'approved' }
  } })).toBe(1)
  expect(loadPrd(prdPath())[0].passes).toBe(false)
})
it('preserves a concurrently changed target rather than merging over it', () => {
  initialize()
  expect(run({ verify: () => {
    writeFileSync(join(root, 'src/value.txt'), 'user edit\n')
    return { passed: true, summary: 'green' }
  } })).toBe(1)
  expect(text('src/value.txt')).toBe('user edit\n')
  expect(loadPrd(prdPath())[0].passes).toBe(false)
})
it('binds target HEAD, not only its working-tree contents', () => {
  initialize()
  expect(run({ verify: () => {
    git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'concurrent head')
    return { passed: true, summary: 'green' }
  } })).toBe(1)
  expect(text('src/value.txt')).toBe('before\n')
})
it('blocks stale edit preconditions before any durable launch or write', () => {
  configure(action({ edits: [{ path: 'src/value.txt', expectedSha256: contentDigest('stale'), content: 'after\n' }] })); initialize()
  expect(run({ verify: () => { throw new Error('must not verify') } })).toBe(1)
  expect(text('src/value.txt', join(root, '.yoke/worktrees', storyPathSegment('S1')))).toBe('before\n')
  expect(readLedger(root)!.ledger.reservations).toHaveLength(0)
})
it('requires an initialized budget instead of ignoring a missing ledger', () => {
  expect(run()).toBe(1); expect(text('src/value.txt')).toBe('before\n'); expect(journals()).toHaveLength(0)
})
it('exhausted budget blocks publication', () => {
  initialize(10); expect(run()).toBe(1)
  expect(text('src/value.txt', join(root, '.yoke/worktrees', storyPathSegment('S1')))).toBe('before\n')
  expect(readLedger(root)!.ledger.reservations).toHaveLength(0)
})
it.each(['in-flight', 'unknown-usage'] as const)('keeps %s attempts charged and blocks a new execution', mode => {
  initialize()
  transactLedger(root, 0, budget => reserveBudget(budget, { id: 'interrupted', taskId: 'S1', role: 'worker', requested: { tokens: 0, costMicrousd: 0, computeMs: 1000 } }).ledger)
  if (mode === 'unknown-usage') transactLedger(root, 1, budget => settleBudget(budget, 'interrupted', { tokens: null, costMicrousd: 0, computeMs: null }, true))
  expect(run()).toBe(1); expect(readLedger(root)!.ledger.reservations).toHaveLength(1)
  expect(text('src/value.txt', join(root, '.yoke/worktrees', storyPathSegment('S1')))).toBe('before\n')
})
it('requires explicitly protected acceptance infrastructure', () => {
  rmSync(join(root, '.yoke/acceptance.yaml')); git('add', '-A'); git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'remove acceptance')
  initialize(); expect(run()).toBe(1); expect(readLedger(root)!.ledger.reservations).toHaveLength(0)
})
it('a broad action grant cannot bypass the story scopes', () => {
  configure(action({ writeScopes: ['tests'] })); initialize()
  expect(run()).toBe(1); expect(readLedger(root)!.ledger.reservations).toHaveLength(0)
})
it('protected test paths cannot be changed even with matching preconditions and story grants', () => {
  configure(action({ writeScopes: ['tests'], edits: [{ path: 'tests/gate.cjs', expectedSha256: contentDigest(text('tests/gate.cjs')), content: '' }] }), story({ writes: ['tests'] }))
  initialize(); expect(run()).toBe(1); expect(readLedger(root)!.ledger.reservations).toHaveLength(0)
})
it('a no-op cannot be interpreted as an accepted managed edit', () => {
  configure(action({ edits: [{ path: 'src/value.txt', expectedSha256: contentDigest('before\n'), content: 'before\n' }] })); initialize()
  expect(run({ verify: () => ({ passed: true, summary: 'green baseline' }) })).toBe(1)
  expect(loadPrd(prdPath())[0].passes).toBe(false)
})
it.each([{ isolate: false }, { git: realGitOps }, { resumeWorktree: true }, { parallel: 2 }])('rejects unsupported execution modes before creating a worktree: %j', options => {
  initialize(); expect(run(options)).toBe(2)
  expect(existsSync(join(root, '.yoke/worktrees', storyPathSegment('S1')))).toBe(false)
})
it('requires real persisted worktree ownership, not just a plausible path', () => {
  initialize(); const token = acquireLock(root).ownerToken!; const fake = join(root, '.yoke/worktrees', storyPathSegment('S1')); mkdirSync(fake, { recursive: true })
  expect(() => runNativeWorkspaceAction({ targetDir: fake, story: story() }, action(), { projectRoot: root, ownerToken: token, protectedScopes: ['tests/gate.cjs'] })).toThrow(/recovery record/)
})
it.each(['runner.pid', 'provider-processes/record.json', 'supervision/record.json'])('refuses unresolved process evidence at %s', path => {
  initialize(); const full = join(root, '.yoke', path); mkdirSync(join(full, '..'), { recursive: true }); writeFileSync(full, '{"state":"termination-unconfirmed"}')
  expect(run()).toBe(1); expect(readLedger(root)!.ledger.reservations).toHaveLength(0)
})
it('an untrusted action caller cannot bypass the loop authority', () => {
  const run = makeActionRunner([action()], () => { throw new Error('must not call model') })
  expect(run({ targetDir: root, story: story() })).toMatchObject({ success: false, infrastructureFailure: true })
  expect(() => NativeWorkspaceActionSchema.parse({ ...action(), shell: true })).toThrow()
})
it('pins the candidate after publication and rejects later changes without running a new action', () => {
  initialize(); const { token, candidate, invoke } = direct(); const result = invoke()
  expect(result.success).toBe(true); expect(() => result.assertStableCandidate!()).not.toThrow()
  writeFileSync(join(candidate, 'src/value.txt'), 'late write')
  expect(() => result.assertStableCandidate!()).toThrow(/changed during verification/)
  releaseLock(root, token)
  expect(() => result.assertStableCandidate!()).toThrow(/own the existing/)
})
it('preserves a failed publication journal and settles known native usage without granting acceptance', () => {
  initialize(); const { candidate, invoke } = direct()
  // Fault injection at controller publication setup: a file where its state directory is required.
  writeFileSync(join(candidate, '.yoke/control-plane'), 'not a directory')
  const result = invoke()
  expect(result).toMatchObject({ success: false, infrastructureFailure: true })
  expect(text('src/value.txt', candidate)).toBe('before\n')
  expect(journals()[0].phase).toBe('failed')
  expect(readLedger(root)!.ledger.reservations[0].usage).not.toBeNull()
})
it('retains an in-flight reservation when the intent journal cannot be persisted', () => {
  initialize(); const { candidate, invoke } = direct()
  writeFileSync(join(root, '.yoke/control-plane/native'), 'not a directory')
  expect(() => invoke()).toThrow()
  expect(readLedger(root)!.ledger.reservations[0].usage).toBeNull()
  expect(text('src/value.txt', candidate)).toBe('before\n')
})
it.runIf(process.platform !== 'win32' || process.env.YOKE_INCLUDE_PLATFORM_TESTS === '1')('does not widen private source permissions on publication', () => {
  initialize(); const { candidate, invoke } = direct(); chmodSync(join(candidate, 'src/value.txt'), 0o600)
  expect(invoke().success).toBe(true); expect(statSync(join(candidate, 'src/value.txt')).mode & 0o777).toBe(0o600)
})
it('CLI snapshot diagnostics expose hashes, explicit coverage and no source content', async () => {
  expect(await main(['workspace-snapshot', root, 'src/value.txt', 'src/new.txt'])).toBe(0)
  const output = JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0])
  expect(output).toMatchObject({ effects: 'none', coverage: 'explicit-files', capture: 'observed-files-not-a-live-freeze' })
  expect(output.files[0].sha256).toBeNull()
  expect(JSON.stringify(output)).not.toContain('before\\n')
  expect(await main(['workspace-snapshot', root, '../outside'])).toBe(2)
  expect(await main(['workspace-snapshot', root])).toBe(2)
})
