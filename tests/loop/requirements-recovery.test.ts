import { execFileSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { createDispatcher } from '../../src/loop/dispatcher.js'
import { makeParallelAdapters } from '../../src/loop/parallel-adapters.js'
import { runLoop } from '../../src/loop/loop.js'
import { realGitOps } from '../../src/loop/git.js'
import { prepareIsolatedWorktree } from '../../src/loop/recovery.js'
import { loadPrd, storyPathSegment, type Story } from '../../src/loop/prd.js'
import { readRequirements, requirementObjective, requirementsDigest } from '../../src/prd/requirements.js'
import { currentContractKey } from '../../src/routing/contracts.js'
import { acceptanceProtectionProblem, protectAcceptance } from '../../src/check/command.js'

const roots: string[] = []
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); vi.unstubAllEnvs() })
function fixture(legacy = false, autocrlf = false) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'contract-recovery-'))); roots.push(root)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()
  const brief = 'Approved offline and online behavior\n', objective = requirementObjective('Preserve edits', brief)
  const story: Story = { id: 'S1', title: 'Preserve edits', priority: 1, passes: false, writes: ['src'],
    ...(!legacy ? { requirementsFor: objective.sha256 } : {}), acceptance: [
      { id: 'offline', text: 'Offline edits persist', verify: ['npm run test:offline'] },
      { id: 'online', text: 'Online edits persist', verify: ['npm run test:online'] },
    ] }
  mkdirSync(join(root, '.yoke')); writeFileSync(join(root, '.gitignore'), '.yoke/worktrees/\n.yoke/integration-recovery/\n.yoke/failure-progress/\n.yoke/proof/\n')
  writeFileSync(join(root, '.yoke', 'prd.yaml'), stringify([story]))
  if (!legacy) {
    writeFileSync(join(root, '.yoke', 'plan.md'), brief)
    writeFileSync(join(root, '.yoke', 'requirements.yaml'), stringify({ version: 1, objective,
      requirements: [{ id: 'R1', text: 'Offline edits persist', criteria: [{ story: 'S1', criterion: 'offline' }] }],
      invariants: [{ id: 'I1', text: 'Online edits persist', criteria: [{ story: 'S1', criterion: 'online' }] }],
    }))
  }
  git('init'); git('config', 'core.autocrlf', String(autocrlf)); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid'); git('config', 'commit.gpgsign', 'false')
  git('add', '.'); git('commit', '-m', 'seed approved contracts')
  return { root, story, git }
}
function change(directory: string, mutation: string): void {
  if (mutation === 'ledger-edit' || mutation === 'parent-ledger-commit') {
    const ledger = readRequirements(directory)!; ledger.invariants[0].text = 'A different valid invariant with the same objective'
    writeFileSync(join(directory, '.yoke', 'requirements.yaml'), stringify(ledger))
    // This remains structurally valid; only comparison with the original source can reject it.
    expect(loadPrd(join(directory, '.yoke', 'prd.yaml'))).toHaveLength(1)
  }
  if (mutation === 'ledger-delete') rmSync(join(directory, '.yoke', 'requirements.yaml'))
  if (mutation === 'ledger-add') writeFileSync(join(directory, '.yoke', 'requirements.yaml'), 'new unauthorized ledger')
  if (mutation === 'plan-edit') writeFileSync(join(directory, '.yoke', 'plan.md'), 'Changed approved plan\n')
  if (mutation === 'plan-delete') rmSync(join(directory, '.yoke', 'plan.md'))
  if (mutation === 'plan-add') writeFileSync(join(directory, '.yoke', 'plan.md'), 'new unauthorized plan')
}
it.each(['ledger-edit', 'ledger-delete', 'ledger-add', 'plan-edit', 'plan-delete', 'plan-add'])('serial recovery rejects %s before another implementation call', mutation => {
  const { root } = fixture(mutation.endsWith('-add'))
  let calls = 0, worktree = '', resume = false
  const run = () => runLoop({ targetDir: root, prdPath: join(root, '.yoke', 'prd.yaml'), isolate: true, maxIterations: 1,
    git: { ...realGitOps, addWorktree: (repo, wt) => prepareIsolatedWorktree(repo, wt, resume) },
    runner: context => { calls++; worktree = context.targetDir; mkdirSync(join(worktree, 'src'), { recursive: true }); writeFileSync(join(worktree, 'src', 'partial.txt'), 'preserve unfinished work'); return { success: true, summary: 'unfinished' } },
    verifyCriterion: () => ({ passed: true, summary: 'criterion green' }), verify: () => ({ passed: false, summary: 'unfinished' }),
  })
  expect(run().status).toBe('blocked'); change(worktree, mutation); resume = true
  const result = run()
  expect(result.status).toBe('blocked'); expect(calls).toBe(1)
  expect(result.reason).toMatch(/contract|protection|stale/i)
  expect(readFileSync(join(worktree, 'src', 'partial.txt'), 'utf8')).toBe('preserve unfinished work')
})
function autocrlfCheckout() {
  const setup = fixture(false, true), worktree = join(setup.root, '.yoke', 'worktrees', 'autocrlf')
  prepareIsolatedWorktree(setup.root, worktree, false)
  expect(readFileSync(join(setup.root, '.yoke', 'plan.md'), 'utf8')).not.toContain('\r\n')
  expect(readFileSync(join(worktree, '.yoke', 'plan.md'), 'utf8')).toContain('\r\n')
  return { ...setup, worktree }
}
it('validates a fresh bound PRD after a real core.autocrlf=true checkout', () => {
  const { root, worktree } = autocrlfCheckout()
  expect(loadPrd(join(worktree, '.yoke', 'prd.yaml'))).toHaveLength(1)
  expect(acceptanceProtectionProblem(worktree, root)).toBeNull()
})
it('keeps ledger and prepared assessment identities across a real CRLF checkout', () => {
  const { root, worktree, story } = autocrlfCheckout()
  expect(requirementsDigest(worktree)).toBe(requirementsDigest(root))
  expect(currentContractKey(worktree, story)).toBe(currentContractKey(root, story))
})
it('keeps pinned planning contracts equivalent after a real CRLF checkout', () => {
  const { root, git } = fixture(false, true)
  const state = mkdtempSync(join(tmpdir(), 'contract-pin-state-')); roots.push(state); vi.stubEnv('YOKE_STATE_DIR', state)
  // Existing acceptance remains byte-exact; write it in its actual checkout form.
  writeFileSync(join(root, '.yoke', 'acceptance.yaml'), 'version: 1\r\ncriteria: []\r\n')
  git('add', '.yoke/acceptance.yaml'); git('commit', '-m', 'pin acceptance fixture'); protectAcceptance(root)
  const worktree = join(root, '.yoke', 'worktrees', 'pinned-autocrlf'); prepareIsolatedWorktree(root, worktree, false)
  expect(acceptanceProtectionProblem(worktree, root)).toBeNull()
})
it.each(['ledger-edit', 'ledger-delete', 'ledger-add', 'plan-edit', 'plan-delete', 'plan-add', 'parent-ledger-commit'])('parallel implementation recovery rejects %s before dispatch', async mutation => {
  const { root, story, git } = fixture(mutation.endsWith('-add'))
  let calls = 0, worktree = ''
  const run = () => createDispatcher({ targetDir: root, stories: [story], maxConcurrency: 1, maxIterations: 1,
    ...makeParallelAdapters(root, { authorName: 'Test', authorEmail: 'test@example.invalid', allowCoAuthors: false }),
    claims: { acquire: () => true, heartbeat: () => undefined, release: () => undefined },
    worker: async input => {
      calls++; worktree = input.worktree.path; mkdirSync(join(worktree, 'src'), { recursive: true }); writeFileSync(join(worktree, 'src', 'partial.txt'), 'preserve unfinished work')
      return { kind: 'mechanical-failure' as const, stage: 'verify' as const, storyId: story.id, worktree, baseCommit: input.worktree.baseCommit, provider: input.provider, summary: 'unfinished', evidence: { criteria: [] }, routing: { outcome: 'pending-integration' as const } }
    }, gates: { verify: () => ({ passed: true, summary: 'not reached' }) },
  }).run()
  expect((await run()).status).toBe('blocked')
  const record = join(root, '.yoke', 'integration-recovery', `${storyPathSegment(story.id)}.json`), before = readFileSync(record, 'utf8')
  expect(JSON.parse(before).phase).toBe('implementation')
  if (mutation === 'parent-ledger-commit') {
    const head = git('rev-parse', 'HEAD'); change(root, mutation); git('add', '.yoke/requirements.yaml'); git('commit', '-m', 'authorize revised invariant')
    expect(git('rev-parse', 'HEAD')).not.toBe(head)
  } else change(worktree, mutation)
  const result = await run()
  expect(result.status).toBe('blocked'); expect(calls).toBe(1)
  expect(result.reason).toMatch(/contract|protection|stale/i)
  expect(readFileSync(record, 'utf8')).toBe(before)
  expect(readFileSync(join(worktree, 'src', 'partial.txt'), 'utf8')).toBe('preserve unfinished work')
})
