import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { makeParallelAdapters } from '../../src/loop/parallel-adapters.js'
import { retainRuntimeProof } from '../../src/loop/proof-retention.js'
import { storyPathSegment } from '../../src/loop/prd.js'
import { createDispatcher } from '../../src/loop/dispatcher.js'
import type { DispatcherWorkerInput } from '../../src/loop/dispatcher.js'
const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))
function fixture(writes?: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'yoke-proof-')); roots.push(root)
  mkdirSync(join(root, '.yoke'))
  writeFileSync(join(root, '.yoke/prd.yaml'), JSON.stringify([{ id: 'A', title: 'proof', priority: 1, acceptance: ['proof'], passes: false, writes }]))
  writeFileSync(join(root, '.gitignore'), '.yoke/worktrees/\n.yoke/artifacts/\n.yoke/proof/\n.yoke/integration-recovery/\n')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim()
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid'); git('add', '.'); git('commit', '-m', 'base')
  const adapters = makeParallelAdapters(root, undefined)
  const base = { story: { id: 'A', title: 'proof', priority: 1, acceptance: ['proof'], passes: false, writes }, ownerToken: 'owner', dispatcherId: 'test', provider: { agent: 'codex', role: 'implementation' } } as const
  const input = { ...base, worktree: adapters.worktrees.create(base), cancellation: {} } as DispatcherWorkerInput
  return { root, adapters, input, git }
}
it('rejects undeclared actual writes before rebasing', () => {
  const { adapters, input } = fixture(['src'])
  writeFileSync(join(input.worktree.path, 'unexpected.txt'), 'change')
  expect(adapters.git.rebase(input)).toMatchObject({ kind: 'reopen', reason: expect.stringContaining('unexpected.txt') })
})
it('retains hashed runtime proof through integration and successful cleanup', () => {
  const { root, adapters, input, git } = fixture()
  const artifact = join(input.worktree.path, '.yoke/artifacts/A/proof.txt')
  mkdirSync(join(artifact, '..'), { recursive: true }); writeFileSync(artifact, 'evidence')
  writeFileSync(join(input.worktree.path, 'app.txt'), 'implementation')
  const rebased = adapters.git.rebase(input) as { expectedHead: string }
  adapters.git.commit(input); adapters.git.integrate(input, rebased.expectedHead); adapters.worktrees.remove(input)
  const retained = join(snapshot(root), 'A/proof.txt')
  expect(existsSync(retained)).toBe(true)
  const manifest = JSON.parse(readFileSync(join(snapshot(root), 'manifest.json'), 'utf8'))
  expect(manifest.files).toContainEqual({ path: 'A/proof.txt', sha256: createHash('sha256').update('evidence').digest('hex') })
  expect(manifest).toMatchObject({ source: expect.any(String), config: expect.any(String), environment: expect.any(String) })
  expect(git('status', '--porcelain')).toBe('')
})
it('rejects linked artifact escape before committing and preserves candidate', () => {
  const { root, adapters, input } = fixture()
  const outside = join(root, 'outside.txt'); writeFileSync(outside, 'private')
  mkdirSync(join(input.worktree.path, '.yoke/artifacts/A'), { recursive: true })
  symlinkSync(outside, join(input.worktree.path, '.yoke/artifacts/A/proof.txt'), 'file')
  writeFileSync(join(input.worktree.path, 'app.txt'), 'implementation')
  expect(() => adapters.git.commit(input)).toThrow(/link/i)
  expect(existsSync(input.worktree.path)).toBe(true)
})

it('rejects nonconflicting edits to the same sibling file before integration', () => {
  const { root, adapters, input, git } = fixture(['shared.txt'])
  writeFileSync(join(root, 'shared.txt'), 'one\ntwo\nthree\n'); git('add', 'shared.txt'); git('commit', '-m', 'sibling')
  writeFileSync(join(input.worktree.path, 'shared.txt'), 'candidate\ntwo\nthree\n')
  expect(adapters.git.rebase(input)).toMatchObject({ kind: 'reopen', reason: expect.stringContaining('sibling') })
})
it('rejects destination manifest links without writing outside runtime proof', () => {
  const { root, adapters, input } = fixture()
  const artifact = join(input.worktree.path, '.yoke/artifacts/A/proof.txt')
  mkdirSync(join(artifact, '..'), { recursive: true }); writeFileSync(artifact, 'evidence')
  const outside = join(root, 'outside.txt'); writeFileSync(outside, 'untouched')
  retainRuntimeProof(input.worktree.path, 'A', root)
  const destination = snapshot(root)
  unlinkSync(join(destination, 'manifest.json')); symlinkSync(outside, join(destination, 'manifest.json'), 'file')
  expect(() => adapters.git.commit(input)).toThrow(/link/i)
  expect(readFileSync(outside, 'utf8')).toBe('untouched')
})
it('blocks integration when an already retained file has a different hash', () => {
  const { root, adapters, input } = fixture()
  const artifact = join(input.worktree.path, '.yoke/artifacts/A/proof.txt')
  mkdirSync(join(artifact, '..'), { recursive: true }); writeFileSync(artifact, 'evidence')
  retainRuntimeProof(input.worktree.path, 'A', root)
  const copied = join(snapshot(root), 'A/proof.txt')
  mkdirSync(join(copied, '..'), { recursive: true }); writeFileSync(copied, 'tampered')
  expect(() => adapters.git.commit(input)).toThrow(/hash mismatch/i)
  expect(existsSync(input.worktree.path)).toBe(true)
})
it('retains smoke proof files as well as command artifacts', () => {
  const { root, adapters, input } = fixture()
  const proof = join(input.worktree.path, '.yoke/proof/flow/report.json')
  mkdirSync(join(proof, '..'), { recursive: true }); writeFileSync(proof, '{"passed":true}')
  writeFileSync(join(input.worktree.path, 'app.txt'), 'implemented')
  adapters.git.commit(input)
  expect(readFileSync(join(snapshot(root), 'proof/flow/report.json'), 'utf8')).toBe('{"passed":true}')
})

it('checks writes again after integrated gates before committing', () => {
  const { adapters, input } = fixture(['src'])
  mkdirSync(join(input.worktree.path, 'src')); writeFileSync(join(input.worktree.path, 'src/app.txt'), 'implemented')
  expect(adapters.git.rebase(input)).toMatchObject({ kind: 'rebased' })
  writeFileSync(join(input.worktree.path, 'gate-generated.txt'), 'unexpected gate output')
  expect(() => adapters.git.commit(input)).toThrow(/gate-generated.txt/)
})

it('retains changed rerun proof separately while preserving the earlier snapshot', () => {
  const { root, input } = fixture()
  const artifact = join(input.worktree.path, '.yoke/artifacts/A/proof.txt')
  mkdirSync(join(artifact, '..'), { recursive: true }); writeFileSync(artifact, 'first proof')
  retainRuntimeProof(input.worktree.path, 'A', root)
  writeFileSync(artifact, 'rerun proof')
  expect(() => retainRuntimeProof(input.worktree.path, 'A', root)).not.toThrow()
  const destination = join(root, '.yoke/proof', storyPathSegment('A'), 'runtime-artifacts')
  const snapshots = readdirSync(destination).filter(name => /^[a-f0-9]{64}$/.test(name))
  expect(snapshots).toHaveLength(2)
  expect(snapshots.map(name => readFileSync(join(destination, name, 'A/proof.txt'), 'utf8')).sort()).toEqual(['first proof', 'rerun proof'])
})

function snapshot(root: string): string {
  const directory = join(root, '.yoke/proof', storyPathSegment('A'), 'runtime-artifacts')
  return join(directory, readdirSync(directory)[0]!)
}

it('does not authorize a parent file through a declared descendant scope', () => {
  const { adapters, input } = fixture(['src/app.ts'])
  writeFileSync(join(input.worktree.path, 'src'), 'unexpected parent replacement')
  expect(adapters.git.rebase(input)).toMatchObject({ kind: 'reopen', reason: expect.stringContaining('src') })
})

it('blocks dispatcher completion and records recovery when proof transfer fails', async () => {
  const { root, adapters, input } = fixture()
  const outside = join(root, '.yoke/artifacts/outside.txt')
  mkdirSync(join(outside, '..'), { recursive: true }); writeFileSync(outside, 'private evidence')
  const result = await createDispatcher({ targetDir: root, stories: [input.story], maxConcurrency: 1, maxIterations: 1, ...adapters,
    claims: { acquire: () => true, heartbeat: () => undefined, release: () => undefined },
    worker: async worker => {
      writeFileSync(join(worker.worktree.path, 'app.txt'), 'implemented')
      const artifact = join(worker.worktree.path, '.yoke/artifacts/A/proof.txt')
      mkdirSync(join(artifact, '..'), { recursive: true }); symlinkSync(outside, artifact, 'file')
      return { kind: 'candidate', storyId: worker.story.id, worktree: worker.worktree.path, baseCommit: worker.worktree.baseCommit, provider: worker.provider, summary: 'implemented', evidence: { criteria: [] }, routing: { outcome: 'pending-integration' } }
    }, gates: { verify: () => ({ passed: true, summary: 'checked' }) },
  }).run()
  expect(result.status).toBe('blocked')
  expect(input.story.passes).toBe(false)
  const saved = JSON.parse(readFileSync(join(root, '.yoke/integration-recovery', storyPathSegment('A') + '.json'), 'utf8'))
  expect(saved.reason).toMatch(/link/i)
  expect(existsSync(saved.worktree)).toBe(true)
  expect(existsSync(join(root, 'app.txt'))).toBe(false)
})
