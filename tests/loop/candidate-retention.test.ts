import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { coordinateCandidates, type CandidateCoordinatorInput } from '../../src/loop/candidates.js'
import { makeParallelAdapters } from '../../src/loop/parallel-adapters.js'
import { storyPathSegment, type Story } from '../../src/loop/prd.js'
import { recoverParallelWorktree } from '../../src/loop/recovery.js'

function fixture(scenario: 'red' | 'pause' | 'cancel' | 'evidence-error' | 'winner') {
  const root = mkdtempSync(join(tmpdir(), 'yoke-candidate-retention-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()
  const story: Story = { id: 'S1', title: 'retain useful candidates', priority: 1, acceptance: ['legacy'], passes: false }
  mkdirSync(join(root, '.yoke'), { recursive: true })
  writeFileSync(join(root, '.gitignore'), '.yoke/*\n!.yoke/prd.yaml\n')
  writeFileSync(join(root, '.yoke/prd.yaml'), JSON.stringify([story]))
  git('init')
  git('add', '.')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'base')
  const adapters = makeParallelAdapters(root, { authorName: 'Test', authorEmail: 'test@example.com', allowCoAuthors: false })
  const provider = { provider: 'codex', role: 'implementation' } as const
  const controller = new AbortController()
  const primary = {
    story, provider, dispatcherId: 'dispatcher', ownerToken: 'primary-owner', cancellation: { signal: controller.signal },
    worktree: adapters.worktrees.create({ story, provider, dispatcherId: 'dispatcher', ownerToken: 'primary-owner' }),
  }
  let paused = false
  const paths: string[] = []
  const input: CandidateCoordinatorInput = {
    story, baseCommit: primary.worktree.baseCommit, coordinatorId: 'race', maxCandidates: 2,
    ownerToken: id => `${primary.ownerToken}-${id}`,
    lifecycle: adapters.candidates(primary), signal: controller.signal, pause: () => paused,
    candidates: ['candidate-1', 'candidate-2'].map((id, index) => ({
      id,
      worker: {
        provider,
        runner: context => {
          paths.push(context.targetDir)
          writeFileSync(join(context.targetDir, 'progress.txt'), `useful work ${id}`)
          if (index === 1 && scenario === 'pause') paused = true
          if (index === 1 && scenario === 'cancel') controller.abort('user stopped race')
          return { success: true, summary: id }
        },
        verify: () => ({ passed: scenario !== 'red' && (scenario !== 'winner' || index === 0), summary: 'gate result' }),
      },
    })),
    evidence: candidate => {
      if (scenario === 'evidence-error') throw new Error('evidence read failed')
      return { digest: `digest-${candidate.candidateId}`, artifacts: [] }
    },
    stageEvidence: () => undefined,
    judgeProvenance: { provider: 'codex', model: 'fixture', promptDigest: 'prompt', rubricDigest: 'rubric' },
    judge: () => { throw new Error('no comparison needed in these scenarios') },
  }
  return { root, story, primary, paths, input }
}

describe('production candidate retention', () => {
  it.each([
    ['red', 'blocked', 'implementation'],
    ['pause', 'paused', 'integration'],
    ['cancel', 'cancelled', 'implementation'],
    ['evidence-error', 'blocked', 'integration'],
  ] as const)('keeps every materialized candidate after %s and binds a resumable primary', async (scenario, kind, phase) => {
    const test = fixture(scenario)
    try {
      const result = await coordinateCandidates(test.input)
      expect(result.kind).toBe(kind)
      expect(test.paths).toHaveLength(2)
      for (const [index, path] of test.paths.entries()) {
        expect(existsSync(path)).toBe(true)
        expect(readFileSync(join(path, 'progress.txt'), 'utf8')).toBe(`useful work candidate-${index + 1}`)
      }
      const directory = join(test.root, '.yoke/integration-recovery')
      const records = readdirSync(directory).filter(file => file.endsWith('.json'))
      expect(records).toHaveLength(2)
      const standard = join(directory, `${storyPathSegment(test.story.id)}.json`)
      const saved = JSON.parse(readFileSync(standard, 'utf8'))
      expect(saved).toMatchObject({ phase, ownerToken: test.primary.ownerToken, worktree: test.primary.worktree.path })
      expect(recoverParallelWorktree(test.root, standard, test.story.id)).toMatchObject({
        path: test.primary.worktree.path, recovered: true, recovery: { phase },
      })
      for (const record of records) expect(recoverParallelWorktree(test.root, join(directory, record), test.story.id)).not.toBeNull()
      expect('summary' in result && result.summary).toContain('work retained at')
      expect(test.story.passes).toBe(false)
    } finally { rmSync(test.root, { recursive: true, force: true }) }
  })

  it('preserves the files and reports retention failure without falling back to removal', async () => {
    const test = fixture('red')
    try {
      const result = await coordinateCandidates({
        ...test.input,
        lifecycle: { ...test.input.lifecycle, retain: () => { throw new Error('recovery disk unavailable') } },
      })
      expect(result).toMatchObject({ kind: 'blocked', reason: 'cleanup-error' })
      expect(test.paths.every(path => existsSync(join(path, 'progress.txt')))).toBe(true)
      if (result.kind !== 'blocked') throw new Error('expected a blocked race')
      expect(result.recovery).toHaveLength(2)
      expect(result.recovery?.every(record => record.failedStages.some(failure => failure.stage === 'retain'))).toBe(true)
    } finally { rmSync(test.root, { recursive: true, force: true }) }
  })

  it('still removes unselected alternatives after successful selection', async () => {
    const test = fixture('winner')
    try {
      const result = await coordinateCandidates(test.input)
      expect(result).toMatchObject({ kind: 'winner', winner: { candidateId: 'candidate-1' } })
      expect(existsSync(test.paths[0]!)).toBe(true)
      expect(existsSync(test.paths[1]!)).toBe(false)
      expect(existsSync(join(test.root, '.yoke/integration-recovery'))).toBe(false)
    } finally { rmSync(test.root, { recursive: true, force: true }) }
  })
})
