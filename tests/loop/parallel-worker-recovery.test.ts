import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createDispatcher, type DispatcherWorkerInput } from '../../src/loop/dispatcher.js'
import { makeParallelAdapters } from '../../src/loop/parallel-adapters.js'
import { loadPrd, storyPathSegment, type Story } from '../../src/loop/prd.js'
import type { StoryWorkerResult } from '../../src/loop/worker.js'
import { runLoopCommand } from '../../src/loop/run-command.js'
import { saveConfig } from '../../src/retrofit/config.js'

const identity = { authorName: 'Test', authorEmail: 'test@example.com', allowCoAuthors: false }
const candidate = (input: DispatcherWorkerInput): Extract<StoryWorkerResult, { kind: 'candidate' }> => ({
  kind: 'candidate', storyId: input.story.id, worktree: input.worktree.path, baseCommit: input.worktree.baseCommit,
  provider: input.provider, summary: 'worker checks passed', evidence: { criteria: [] }, routing: { outcome: 'pending-integration' },
})

function fixture() {
  // Match the canonical ownership paths persisted by recovery on Windows too.
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'yoke-worker-recovery-')))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()
  const story: Story = { id: 'A', title: 'recover incomplete work', priority: 1, acceptance: ['legacy'], passes: false }
  mkdirSync(join(root, '.yoke'), { recursive: true })
  writeFileSync(join(root, '.gitignore'), '.yoke/worktrees/\n.yoke/integration-recovery/\n')
  writeFileSync(join(root, '.yoke', 'prd.yaml'), JSON.stringify([story]))
  git('init')
  git('add', '.')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'base')
  return { root, git, story, record: join(root, '.yoke', 'integration-recovery', `${storyPathSegment(story.id)}.json`) }
}

describe('parallel incomplete worker recovery', () => {
  it('passes saved gate feedback through the real command and worker before completing the retained implementation', async () => {
    const { root, git, record } = fixture()
    const state = mkdtempSync(join(tmpdir(), 'yoke-worker-recovery-state-'))
    let calls = 0
    let workerPath = ''
    const failure = 'tracking restart still fails after precise location permission'
    try {
      vi.stubEnv('XDG_STATE_HOME', state)
      vi.stubEnv('LOCALAPPDATA', '')
      saveConfig(root, { canonVersion: 'test', agents: ['codex'], loop: { enabled: true } })
      writeFileSync(join(root, '.gitignore'), '.yoke/*\n!.yoke/config.yaml\n!.yoke/prd.yaml\n')
      git('config', 'user.name', 'Test')
      git('config', 'user.email', 'test@example.com')
      git('config', 'commit.gpgsign', 'false')
      git('add', '.gitignore', '.yoke/config.yaml')
      git('commit', '-m', 'command recovery fixture')
      const run = () => runLoopCommand(root, {
        parallel: 2, maxIterations: 1, agent: 'codex', routing: false, quiet: true,
        runner: context => {
          calls++
          if (calls === 1) {
            workerPath = context.targetDir
            expect(context.feedback).toBeUndefined()
            writeFileSync(join(workerPath, 'implementation.txt'), 'partial GPS implementation')
          } else {
            expect(context.targetDir).toBe(workerPath)
            expect(context.feedback).toBe(failure)
            expect(readFileSync(join(workerPath, 'implementation.txt'), 'utf8')).toBe('partial GPS implementation')
            writeFileSync(join(workerPath, 'implementation.txt'), 'repaired GPS implementation')
          }
          return { success: true, summary: 'implementation attempt completed' }
        },
        verify: path => ({ passed: readFileSync(join(path, 'implementation.txt'), 'utf8') === 'repaired GPS implementation', summary: failure }),
        intake: () => ({ ok: true, added: 0, summary: 'no intake' }), isAvailable: () => false,
      })
      expect(await run()).toBe(1)
      expect(JSON.parse(readFileSync(record, 'utf8'))).toMatchObject({ phase: 'implementation', reason: failure })
      expect(loadPrd(join(root, '.yoke/prd.yaml'))[0]?.passes).toBe(false)
      expect(await run()).toBe(0)
      expect(calls).toBe(2)
      expect(loadPrd(join(root, '.yoke/prd.yaml'))[0]?.passes).toBe(true)
      expect(readFileSync(join(root, 'implementation.txt'), 'utf8')).toBe('repaired GPS implementation')
      expect(existsSync(record)).toBe(false)
      expect(existsSync(workerPath)).toBe(false)
    } finally {
      vi.unstubAllEnvs()
      rmSync(root, { recursive: true, force: true })
      rmSync(state, { recursive: true, force: true })
    }
  })

  it.each([
    ['mechanical-failure', 'blocked', 'implementation'],
    ['quality-failure', 'blocked', 'implementation'],
    ['review-failure', 'blocked', 'implementation'],
    ['paused', 'paused', 'implementation'],
    ['decision', 'cancelled', 'implementation'],
    ['ambiguity', 'cancelled', 'implementation'],
    ['cancelled', 'cancelled', 'implementation'],
    ['thrown', 'blocked', 'implementation'],
    ['pause-after-candidate', 'paused', 'integration'],
    ['cancel-after-candidate', 'cancelled', 'integration'],
  ] as const)('preserves %s and resumes the appropriate phase', async (scenario, status, phase) => {
    const { root, story, record } = fixture()
    let calls = 0
    let paused = false
    let firstPath = ''
    const feedback = `retained evidence: ${scenario}`
    const releases: number[] = []
    try {
      const run = () => {
        const adapters = makeParallelAdapters(root, identity)
        const dispatcher = createDispatcher({
          targetDir: root, stories: [story], maxConcurrency: 1, maxIterations: 2, ...adapters,
          pause: () => paused,
          candidateCount: calls > 0 ? 2 : undefined,
          candidateCoordinator: () => { throw new Error('recovery must resume the existing worker, not start a candidate race') },
          claims: {
            acquire: () => true, heartbeat: () => undefined,
            release: () => {
              releases.push(calls)
              if (releases.length === 1) {
                const saved = JSON.parse(readFileSync(record, 'utf8'))
                expect(saved).toMatchObject({ version: 2, phase, storyId: story.id, state: 'retained' })
                expect(saved.worktree).toBe(firstPath)
                expect(dirname(record)).not.toBe(firstPath)
                expect(readFileSync(join(saved.worktree, 'implementation.txt'), 'utf8')).toBe('useful partial implementation')
              }
            },
          },
          worker: async input => {
            calls++
            if (calls > 1) {
              expect(input.worktree.path).toBe(firstPath)
              const saved = JSON.parse(readFileSync(record, 'utf8'))
              expect(input.worktree.recovery).toEqual({ phase: 'implementation', feedback, ...(saved.observation ? { observation: saved.observation } : {}) })
              if (scenario === 'thrown') expect(saved.observation).toMatchObject({ failureCategory: 'unknown', failureCause: 'unknown' })
              expect(readFileSync(join(input.worktree.path, 'implementation.txt'), 'utf8')).toBe('useful partial implementation')
              writeFileSync(join(input.worktree.path, 'implementation.txt'), 'repaired implementation')
              return candidate(input)
            }
            firstPath = input.worktree.path
            writeFileSync(join(firstPath, 'implementation.txt'), 'useful partial implementation')
            const base = { ...candidate(input), summary: feedback }
            switch (scenario) {
              case 'mechanical-failure': return { ...base, kind: 'mechanical-failure', stage: 'verify' }
              case 'quality-failure': return { ...base, kind: 'quality-failure', reason: 'infrastructure' }
              case 'review-failure': return { ...base, kind: 'review-failure', reason: 'malformed' }
              case 'paused': return { ...base, kind: 'paused' }
              case 'decision': return { ...base, kind: 'paused', reason: 'decision' }
              case 'ambiguity': return { ...base, kind: 'paused', reason: 'ambiguity' }
              case 'cancelled': dispatcher.cancel(feedback); return { ...base, kind: 'cancelled' }
              case 'thrown': throw new Error(feedback)
              case 'pause-after-candidate': paused = true; return base
              case 'cancel-after-candidate': dispatcher.cancel(feedback); return base
            }
          },
          gates: { verify: path => ({ passed: existsSync(join(path, 'implementation.txt')), summary: 'integration check' }) },
        })
        return dispatcher.run()
      }
      expect((await run()).status).toBe(status)
      expect(story.passes).toBe(false)
      expect(existsSync(firstPath)).toBe(true)
      expect(existsSync(join(root, 'implementation.txt'))).toBe(false)
      expect(releases).toEqual([1])
      const saved = JSON.parse(readFileSync(record, 'utf8'))
      if (phase === 'implementation') expect(saved.reason).toBe(feedback)
      paused = false
      expect((await run()).status).toBe('complete')
      expect(calls).toBe(phase === 'implementation' ? 2 : 1)
      expect(readFileSync(join(root, 'implementation.txt'), 'utf8')).toBe(phase === 'implementation' ? 'repaired implementation' : 'useful partial implementation')
      expect(existsSync(record)).toBe(false)
      expect(existsSync(firstPath)).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('preserves the original ownership and latest failure after repeated incomplete resumes', async () => {
    const { root, story, record } = fixture()
    let calls = 0
    let firstPath = ''
    const claimOwners: string[] = []
    try {
      const run = () => createDispatcher({
        targetDir: root, stories: [story], maxConcurrency: 1, maxIterations: 1, ...makeParallelAdapters(root, identity),
        claims: { acquire: input => { claimOwners.push(input.ownerToken); return true }, heartbeat: () => undefined, release: () => undefined },
        worker: async input => {
          calls++
          if (calls === 1) firstPath = input.worktree.path
          else {
            expect(input.worktree.path).toBe(firstPath)
            expect(input.worktree.recovery).toEqual({ phase: 'implementation', feedback: `failure ${calls - 1}` })
          }
          writeFileSync(join(input.worktree.path, 'implementation.txt'), `partial ${calls}`)
          return { ...candidate(input), kind: 'mechanical-failure', stage: 'verify', summary: `failure ${calls}` }
        },
        gates: { verify: () => ({ passed: true, summary: 'must not accept incomplete work' }) },
      }).run()
      expect((await run()).status).toBe('blocked')
      const first = JSON.parse(readFileSync(record, 'utf8'))
      expect((await run()).status).toBe('blocked')
      const second = JSON.parse(readFileSync(record, 'utf8'))
      expect(second).toMatchObject({ ownerToken: first.ownerToken, worktree: first.worktree, phase: 'implementation', reason: 'failure 2' })
      expect(claimOwners).toHaveLength(2)
      expect(claimOwners[0]).not.toBe(claimOwners[1])
      expect(readFileSync(join(firstPath, 'implementation.txt'), 'utf8')).toBe('partial 2')
      expect(existsSync(join(root, 'implementation.txt'))).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('treats old records without a phase as integration recovery', async () => {
    const { root, story, record } = fixture()
    let calls = 0
    let passed = false
    try {
      const run = () => createDispatcher({
        targetDir: root, stories: [story], maxConcurrency: 1, maxIterations: 1, ...makeParallelAdapters(root, identity),
        claims: { acquire: () => true, heartbeat: () => undefined, release: () => undefined },
        worker: async input => { calls++; writeFileSync(join(input.worktree.path, 'implementation.txt'), 'already checked'); return candidate(input) },
        gates: { verify: () => ({ passed, summary: 'integration gate red' }) },
      }).run()
      expect((await run()).status).toBe('blocked')
      const { phase: _phase, ...saved } = JSON.parse(readFileSync(record, 'utf8'))
      writeFileSync(record, JSON.stringify({ ...saved, version: 1 }))
      passed = true
      expect((await run()).status).toBe('complete')
      expect(calls).toBe(1)
      expect(readFileSync(join(root, 'implementation.txt'), 'utf8')).toBe('already checked')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('resumes incomplete work after accepted siblings advance the target without changing its acceptance contract', async () => {
    const { root, git, story, record } = fixture()
    const sibling: Story = { id: 'B', title: 'accepted sibling', priority: 2, acceptance: ['other'], passes: false }
    let calls = 0
    try {
      writeFileSync(join(root, '.yoke', 'prd.yaml'), JSON.stringify([story, sibling]))
      git('add', '.yoke/prd.yaml')
      git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'add sibling contract')
      const initialBase = git('rev-parse', 'HEAD')
      const run = () => createDispatcher({
        targetDir: root, stories: [story], maxConcurrency: 1, maxIterations: 1, ...makeParallelAdapters(root, identity),
        claims: { acquire: () => true, heartbeat: () => undefined, release: () => undefined },
        worker: async input => {
          calls++
          if (calls === 1) {
            writeFileSync(join(input.worktree.path, 'implementation.txt'), 'preserve me')
            writeFileSync(join(root, 'sibling.txt'), 'accepted sibling work')
            writeFileSync(join(root, '.yoke', 'prd.yaml'), JSON.stringify([story, { ...sibling, passes: true }]))
            git('add', 'sibling.txt', '.yoke/prd.yaml')
            git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'accept sibling')
            return { ...candidate(input), kind: 'mechanical-failure', stage: 'verify', summary: 'repair remaining failure' }
          }
          expect(input.worktree.baseCommit).toBe(initialBase)
          expect(input.worktree.recovery).toEqual({ phase: 'implementation', feedback: 'repair remaining failure' })
          expect(readFileSync(join(input.worktree.path, 'implementation.txt'), 'utf8')).toBe('preserve me')
          return candidate(input)
        },
        gates: { verify: path => ({ passed: existsSync(join(path, 'sibling.txt')) && existsSync(join(path, 'implementation.txt')), summary: 'both changes must survive integration' }) },
      }).run()
      expect((await run()).status).toBe('blocked')
      expect(JSON.parse(readFileSync(record, 'utf8')).baseCommit).toBe(initialBase)
      expect(git('rev-parse', 'HEAD')).not.toBe(initialBase)
      expect((await run()).status).toBe('complete')
      expect(calls).toBe(2)
      expect(readFileSync(join(root, 'implementation.txt'), 'utf8')).toBe('preserve me')
      expect(readFileSync(join(root, 'sibling.txt'), 'utf8')).toBe('accepted sibling work')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it.each(['acceptance contract', 'rewound target'] as const)('refuses incomplete recovery after a changed %s without discarding it', async change => {
    const { root, git, story, record } = fixture()
    let calls = 0
    try {
      const initialHead = git('rev-parse', 'HEAD')
      writeFileSync(join(root, 'setup.txt'), 'worker base')
      git('add', 'setup.txt')
      git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'advance worker base')
      const run = () => createDispatcher({
        targetDir: root, stories: [story], maxConcurrency: 1, maxIterations: 1, ...makeParallelAdapters(root, identity),
        claims: { acquire: () => true, heartbeat: () => undefined, release: () => undefined },
        worker: async input => {
          calls++
          writeFileSync(join(input.worktree.path, 'implementation.txt'), 'only copy')
          return { ...candidate(input), kind: 'mechanical-failure', stage: 'verify', summary: 'unfinished' }
        },
        gates: { verify: () => ({ passed: true, summary: 'not reached' }) },
      }).run()
      expect((await run()).status).toBe('blocked')
      const saved = JSON.parse(readFileSync(record, 'utf8'))
      if (change === 'acceptance contract') writeFileSync(join(root, '.yoke', 'prd.yaml'), JSON.stringify([{ ...story, acceptance: ['different contract'] }]))
      else git('reset', '--hard', initialHead)
      const result = await run()
      expect(result.status).toBe('blocked')
      expect(result.reason).toContain('stale against target or PRD')
      expect(calls).toBe(1)
      expect(readFileSync(join(saved.worktree, 'implementation.txt'), 'utf8')).toBe('only copy')
      expect(JSON.parse(readFileSync(record, 'utf8'))).toEqual(saved)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('keeps the recovery record, worktree and claim when provider cleanup fails', async () => {
    const { root, story, record } = fixture()
    const events: string[] = []
    try {
      const adapters = makeParallelAdapters(root, identity)
      const dispatcher = createDispatcher({
        targetDir: root, stories: [story], maxConcurrency: 1, maxIterations: 1, ...adapters,
        worktrees: {
          ...adapters.worktrees,
          cleanupProcess: () => { events.push('process'); throw new Error('provider tree is still alive') },
          remove: input => { events.push('remove'); adapters.worktrees.remove(input) },
        },
        claims: { acquire: () => true, heartbeat: () => undefined, release: () => { events.push('release') } },
        worker: async input => {
          writeFileSync(join(input.worktree.path, 'implementation.txt'), 'only copy')
          return { ...candidate(input), kind: 'mechanical-failure', stage: 'verify', summary: 'red test' }
        },
        gates: { verify: () => ({ passed: true, summary: 'not reached' }) },
      })
      await expect(dispatcher.run()).rejects.toThrow('provider tree is still alive')
      expect(events).toEqual(['process', 'process'])
      const saved = JSON.parse(readFileSync(record, 'utf8'))
      expect(saved).toMatchObject({ phase: 'implementation', reason: 'red test' })
      expect(readFileSync(join(saved.worktree, 'implementation.txt'), 'utf8')).toBe('only copy')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it.each(['worker', 'integration'] as const)('keeps work and its claim if the %s recovery record cannot be persisted', async failureAt => {
    const { root, story, record } = fixture()
    let workerPath = ''
    const events: string[] = []
    try {
      const adapters = makeParallelAdapters(root, identity)
      const dispatcher = createDispatcher({
        targetDir: root, stories: [story], maxConcurrency: 1, maxIterations: 1, ...adapters,
        worktrees: {
          ...adapters.worktrees,
          retain: () => { events.push('retain'); throw new Error('recovery store unavailable') },
          cleanupProcess: input => { events.push('process'); adapters.worktrees.cleanupProcess?.(input) },
          remove: input => { events.push('remove'); adapters.worktrees.remove(input) },
        },
        claims: { acquire: () => true, heartbeat: () => undefined, release: () => { events.push('release') } },
        worker: async input => {
          workerPath = input.worktree.path
          writeFileSync(join(workerPath, 'implementation.txt'), 'only copy')
          return failureAt === 'worker' ? { ...candidate(input), kind: 'mechanical-failure', stage: 'verify', summary: 'red test' } : candidate(input)
        },
        gates: { verify: () => ({ passed: false, summary: 'integration red' }) },
      })
      await expect(dispatcher.run()).rejects.toThrow('recovery store unavailable')
      expect(events).toContain('process')
      expect(events).not.toContain('remove')
      expect(events).not.toContain('release')
      expect(existsSync(record)).toBe(false)
      expect(readFileSync(join(workerPath, 'implementation.txt'), 'utf8')).toBe('only copy')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
