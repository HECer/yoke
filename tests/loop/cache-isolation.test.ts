import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { runParallelLoopCommand } from '../../src/loop/parallel-command.js'
import { noopReporter } from '../../src/loop/reporter.js'
import { runLoop } from '../../src/loop/loop.js'
import { runStoryWorker } from '../../src/loop/worker.js'
import { makeParallelAdapters } from '../../src/loop/parallel-adapters.js'
import type { DispatcherWorkerInput } from '../../src/loop/dispatcher.js'
const roots: string[] = []
afterEach(() => { vi.unstubAllEnvs(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })) })
const story = { id: 'A', title: 'cache isolation', priority: 1, acceptance: ['legacy'], passes: false }
function directory(label: string) { const dir = mkdtempSync(join(tmpdir(), label)); roots.push(dir); return dir }
function link(worktree: string, relativePath: string, outside: string) {
  const path = join(worktree, relativePath); mkdirSync(dirname(path), { recursive: true }); symlinkSync(outside, path, 'junction')
}
it.each(['node_modules', 'node_modules/.vite-temp', 'node_modules/.vite', 'node_modules/.cache', '.vite-temp', '.vite', '.cache'])('blocks worker gates when %s resolves outside the candidate', async path => {
  const root = directory('yoke-cache-root-'), worktree = directory('yoke-cache-worker-'), outside = directory('yoke-cache-outside-')
  link(worktree, path, outside)
  let gates = 0
  const result = await runStoryWorker({ story, worktree, baseCommit: 'base', failureRoot: root, provider: { provider: 'codex', role: 'implementation' }, runner: () => ({ success: true, summary: 'implemented' }), verify: () => { gates++; return { passed: true, summary: 'green' } } })
  expect(result.kind).toBe('mechanical-failure')
  expect(result.summary).toContain(path)
  expect(result.summary).toContain('worktree-local')
  expect(gates).toBe(0)
})
it('permits package-level pnpm links and shared package download caches', async () => {
  const root = directory('yoke-cache-root-'), worktree = directory('yoke-cache-worker-'), outside = directory('yoke-cache-package-')
  link(worktree, 'node_modules/package', outside); link(worktree, 'package-download-cache', outside)
  let gates = 0
  const result = await runStoryWorker({ story, worktree, baseCommit: 'base', failureRoot: root, provider: { provider: 'codex', role: 'implementation' }, runner: () => ({ success: true, summary: 'implemented' }), verify: () => { gates++; return { passed: true, summary: 'green' } } })
  expect(result.kind).toBe('candidate'); expect(gates).toBe(1)
})
it('blocks serial isolated gates and preserves the worktree for repair', () => {
  const root = directory('yoke-cache-serial-'), outside = directory('yoke-cache-outside-')
  mkdirSync(join(root, '.yoke')); const prdPath = join(root, '.yoke/prd.yaml'); writeFileSync(prdPath, JSON.stringify([story]))
  let gates = 0, commits = 0, retained = ''
  const result = runLoop({ targetDir: root, prdPath, isolate: true, maxIterations: 1,
    git: { isClean: () => true, addWorktree: (_root, path) => { retained = path; mkdirSync(join(path, '.yoke'), { recursive: true }); copyFileSync(prdPath, join(path, '.yoke/prd.yaml')) }, commitAll: () => { commits++ }, integrate: () => undefined, removeWorktree: () => { throw new Error('must retain') } },
    runner: context => { link(context.targetDir, 'node_modules', outside); return { success: true, summary: 'implemented' } },
    verify: () => { gates++; return { passed: true, summary: 'green' } },
  })
  expect(result.status).toBe('blocked'); expect(result.reason).toContain('node_modules')
  expect(gates).toBe(0); expect(commits).toBe(0); expect(existsSync(retained)).toBe(true)
})
it('blocks production parallel rebase before recovered integration gates can run', () => {
  const root = directory('yoke-cache-parallel-'), outside = directory('yoke-cache-outside-')
  mkdirSync(join(root, '.yoke')); writeFileSync(join(root, '.yoke/prd.yaml'), JSON.stringify([story])); writeFileSync(join(root, '.gitignore'), '.yoke/worktrees/\n.yoke/integration-recovery/\n')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid'); git('add', '.'); git('commit', '-m', 'base')
  const adapters = makeParallelAdapters(root, undefined)
  const base = { story, dispatcherId: 'cache-test', ownerToken: 'owner', provider: { provider: 'codex', role: 'implementation' } } as const
  const input = { ...base, worktree: adapters.worktrees.create(base), cancellation: {} } as DispatcherWorkerInput
  link(input.worktree.path, 'node_modules/.vite-temp', outside)
  expect(adapters.git.rebase(input)).toMatchObject({ kind: 'reopen', reason: expect.stringContaining('node_modules/.vite-temp') })
})

it('rejects dangling cache junctions instead of treating them as absent', async () => {
  const root = directory('yoke-cache-root-'), worktree = directory('yoke-cache-worker-'), outside = directory('yoke-cache-missing-')
  link(worktree, 'node_modules', outside); rmSync(outside, { recursive: true, force: true })
  let gates = 0
  const result = await runStoryWorker({ story, worktree, baseCommit: 'base', failureRoot: root, provider: { provider: 'codex', role: 'implementation' }, runner: () => ({ success: true, summary: 'implemented' }), verify: () => { gates++; return { passed: true, summary: 'green' } } })
  expect(result.kind).toBe('mechanical-failure'); expect(result.summary).toContain('dangling'); expect(gates).toBe(0)
})
it('allows dependency-root links contained within the candidate', async () => {
  const root = directory('yoke-cache-root-'), worktree = directory('yoke-cache-worker-')
  const local = join(worktree, 'local-dependencies'); mkdirSync(local); link(worktree, 'node_modules', local)
  const result = await runStoryWorker({ story, worktree, baseCommit: 'base', failureRoot: root, provider: { provider: 'codex', role: 'implementation' }, runner: () => ({ success: true, summary: 'implemented' }), verify: () => ({ passed: true, summary: 'green' }) })
  expect(result.kind).toBe('candidate')
})
it('does not apply isolated cache policy to standalone root verification', () => {
  const root = directory('yoke-cache-standalone-'), outside = directory('yoke-cache-outside-')
  const prdPath = join(root, 'prd.yaml'); writeFileSync(prdPath, JSON.stringify([story])); link(root, 'node_modules', outside)
  let gates = 0, commits = 0
  const result = runLoop({ targetDir: root, prdPath, maxIterations: 1,
    git: { isClean: () => true, addWorktree: () => undefined, commitAll: () => { commits++ }, integrate: () => undefined, removeWorktree: () => undefined },
    runner: () => ({ success: true, summary: 'implemented' }), verify: () => { gates++; return { passed: true, summary: 'green' } },
  })
  expect(result.status).toBe('complete'); expect(gates).toBe(1); expect(commits).toBe(1)
})

it.each([false, true])('rechecks production parallel cache boundaries before each gate (second criterion: %s)', async secondCriterion => {
  const root = directory('yoke-cache-command-'), outside = directory('yoke-cache-outside-'), pool = directory('yoke-cache-pool-')
  vi.stubEnv('XDG_STATE_HOME', pool); vi.stubEnv('LOCALAPPDATA', '')
  mkdirSync(join(root, '.yoke'))
  const acceptance = [{ id: 'cache-a', text: 'first proof', verify: ['npm test cache-a'] }, { id: 'cache-b', text: 'second proof', verify: ['npm test cache-b'] }]
  const prdPath = join(root, '.yoke/prd.yaml'); writeFileSync(prdPath, JSON.stringify([{ ...story, acceptance }]))
  writeFileSync(join(root, '.gitignore'), '.yoke/*\n!.yoke/prd.yaml\n')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid'); git('add', '.'); git('commit', '-m', 'base')
  let criteria = 0, verifies = 0
  const code = await runParallelLoopCommand({ targetDir: root, prdPath, maxConcurrency: 2, maxIterations: 1,
    runnerAgent: 'codex', idleMs: 10000, permissions: 'safe', selection: {}, providers: [{ provider: 'codex' }], affinityProviders: [{ provider: 'codex' }], onAmbiguity: 'resolve', requireCriterionEvidence: true, reporter: noopReporter,
    runner: context => { writeFileSync(join(context.targetDir, 'app.txt'), 'implemented'); return { success: true, summary: 'implemented' } },
    verifyCriterion: path => { criteria++; if (criteria === (secondCriterion ? 1 : 2)) link(path, 'node_modules', outside); return { passed: true, summary: 'first criterion wrote a cache link' } },
    verify: () => { verifies++; return { passed: true, summary: 'green' } },
  })
  expect(code).toBe(1); expect(criteria).toBe(secondCriterion ? 1 : 2); expect(verifies).toBe(0)
})

it.each([false, true])('rechecks serial isolation before each criterion and verify gate (early link: %s)', earlyLink => {
  const root = directory('yoke-cache-serial-gates-'), outside = directory('yoke-cache-outside-')
  mkdirSync(join(root, '.yoke')); const prdPath = join(root, '.yoke/prd.yaml')
  const acceptance = [{ id: 'cache-a', text: 'first proof', verify: ['npm test cache-a'] }, { id: 'cache-b', text: 'second proof', verify: ['npm test cache-b'] }]
  writeFileSync(prdPath, JSON.stringify([{ ...story, acceptance }]))
  let criteria = 0, verifies = 0
  const result = runLoop({ targetDir: root, prdPath, isolate: true, maxIterations: 1,
    git: { isClean: () => true, addWorktree: (_root, path) => { mkdirSync(join(path, '.yoke'), { recursive: true }); copyFileSync(prdPath, join(path, '.yoke/prd.yaml')) }, commitAll: () => undefined, integrate: () => undefined, removeWorktree: () => undefined },
    runner: () => ({ success: true, summary: 'implemented' }),
    verifyCriterion: path => { criteria++; if (criteria === (earlyLink ? 1 : 2)) link(path, 'node_modules', outside); return { passed: true, summary: 'proof installed a link' } },
    verify: () => { verifies++; return { passed: true, summary: 'green' } },
  })
  expect(result.status).toBe('blocked'); expect(criteria).toBe(earlyLink ? 1 : 2); expect(verifies).toBe(0)
})

it.each(['design', 'perf', 'audit'] as const)('guards serial %s after verify changes a cache boundary', stage => {
  const root = directory('yoke-cache-serial-later-'), outside = directory('yoke-cache-outside-')
  mkdirSync(join(root, '.yoke')); const prdPath = join(root, '.yoke/prd.yaml'); writeFileSync(prdPath, JSON.stringify([story]))
  let later = 0
  const result = runLoop({ targetDir: root, prdPath, isolate: true, maxIterations: 1,
    git: { isClean: () => true, addWorktree: (_root, path) => { mkdirSync(join(path, '.yoke'), { recursive: true }); copyFileSync(prdPath, join(path, '.yoke/prd.yaml')) }, commitAll: () => undefined, integrate: () => undefined, removeWorktree: () => undefined },
    runner: () => ({ success: true, summary: 'implemented' }), verify: path => { link(path, 'node_modules', outside); return { passed: true, summary: 'verify created a link' } },
    [stage]: () => { later++; return { passed: true, summary: 'later gate' } },
  })
  expect(result.status).toBe('blocked'); expect(later).toBe(0)
})
it.each(['design', 'perf', 'audit'] as const)('guards production parallel %s after verify changes a cache boundary', async stage => {
  const root = directory('yoke-cache-parallel-later-'), outside = directory('yoke-cache-outside-'), pool = directory('yoke-cache-pool-')
  vi.stubEnv('XDG_STATE_HOME', pool); vi.stubEnv('LOCALAPPDATA', '')
  mkdirSync(join(root, '.yoke')); const prdPath = join(root, '.yoke/prd.yaml'); writeFileSync(prdPath, JSON.stringify([story])); writeFileSync(join(root, '.gitignore'), '.yoke/*\n!.yoke/prd.yaml\n')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid'); git('add', '.'); git('commit', '-m', 'base')
  let later = 0
  const code = await runParallelLoopCommand({ targetDir: root, prdPath, maxConcurrency: 2, maxIterations: 1,
    runnerAgent: 'codex', idleMs: 10000, permissions: 'safe', selection: {}, providers: [{ provider: 'codex' }], affinityProviders: [{ provider: 'codex' }], onAmbiguity: 'resolve', requireCriterionEvidence: false, reporter: noopReporter,
    runner: context => { writeFileSync(join(context.targetDir, 'app.txt'), 'implemented'); return { success: true, summary: 'implemented' } },
    verifyCriterion: () => ({ passed: true, summary: 'legacy' }), verify: path => { link(path, 'node_modules', outside); return { passed: true, summary: 'verify created a link' } },
    [stage]: () => { later++; return { passed: true, summary: 'later gate' } },
  })
  expect(code).toBe(1); expect(later).toBe(0)
})
