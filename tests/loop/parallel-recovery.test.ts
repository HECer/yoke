import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDispatcher } from '../../src/loop/dispatcher.js'
import { makeParallelAdapters } from '../../src/loop/parallel-adapters.js'
import { storyPathSegment, type Story } from '../../src/loop/prd.js'
import { runLoopCleanup } from '../../src/loop/cleanup.js'
import { makeReporter } from '../../src/loop/reporter.js'
import { localUsageReport } from '../../src/observability/local-report.js'

describe('parallel retained candidate recovery', () => {
  it.each(['unchanged', 'prd changed', 'ownership changed', 'target changed', 'other accepted', 'linked record', 'oversized record', 'cleanup'] as const)('checks preserved work without another model call: %s', async mutation => {
    const root = mkdtempSync(join(tmpdir(), 'yoke-recover-'))
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
    try {
      mkdirSync(join(root, '.yoke'), { recursive: true })
      writeFileSync(join(root, '.gitignore'), '.yoke/worktrees/\n.yoke/integration-recovery/\n.yoke/events/\n.yoke/history/\n')
      const acceptance = [{ id: 'A', title: 'recover', priority: 1, acceptance: ['legacy'], passes: false }, { id: 'B', title: 'other', priority: 2, acceptance: ['other'], passes: false }]
      writeFileSync(join(root, '.yoke', 'prd.yaml'), JSON.stringify(acceptance))
      git('init'); git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'base')
      const story: Story = { id: 'A', title: 'recover', priority: 1, acceptance: ['legacy'], passes: false }
      let modelCalls = 0
      let passed = false
      const observation = { failureId: '12345678-1234-1234-1234-123456789abc', failureCategory: 'observer', failureCause: 'invalid-evidence' } as const
      const reporter = makeReporter(root, { quiet: true })
      const run = () => {
        const adapters = makeParallelAdapters(root, { authorName: 'Test', authorEmail: 'test@example.com', allowCoAuthors: false })
        return createDispatcher({ targetDir: root, stories: [story], maxConcurrency: 1, maxIterations: 3,
          claims: { acquire: () => true, heartbeat: () => undefined, release: () => undefined },
          ...adapters,
          worker: async input => {
            modelCalls++
            if (mutation === 'other accepted' && modelCalls === 1) {
              writeFileSync(join(root, '.yoke', 'prd.yaml'), JSON.stringify(acceptance.map(item => ({ ...item, passes: item.id === 'B' }))))
              git('add', '.yoke/prd.yaml'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'accepted B')
            }
            writeFileSync(join(input.worktree.path, 'implemented.txt'), 'preserved work')
            return { kind: 'candidate', storyId: story.id, worktree: input.worktree.path, baseCommit: input.worktree.baseCommit, provider: input.provider, summary: 'implemented', evidence: { criteria: [] }, routing: { outcome: 'pending-integration' } }
          },
          gates: { verify: path => ({ passed: passed && readFileSync(join(path, 'implemented.txt'), 'utf8') === 'preserved work', summary: 'independent rejection', failure: observation }) },
          onFailure: (failure, storyId) => reporter.failure?.(failure, storyId),
        }).run()
      }
      expect((await run()).status).toBe('blocked')
      const record = join(root, '.yoke', 'integration-recovery', `${storyPathSegment('A')}.json`)
      const saved = JSON.parse(readFileSync(record, 'utf8'))
      expect(saved.reason).toBe('independent rejection')
      expect(saved.observation).toEqual(observation)
      expect(readFileSync(join(saved.worktree, 'implemented.txt'), 'utf8')).toBe('preserved work')
      if (mutation === 'prd changed') writeFileSync(join(root, '.yoke', 'prd.yaml'), JSON.stringify([{ ...acceptance[0], acceptance: ['changed'] }]))
      if (mutation === 'ownership changed') writeFileSync(record, JSON.stringify({ ...saved, ownerToken: 'untrusted' }))
      if (mutation === 'linked record') { const outside = join(root, 'outside-record.json'); renameSync(record, outside); symlinkSync(outside, record, 'file') }
      if (mutation === 'oversized record') writeFileSync(record, JSON.stringify({ ...saved, reason: 'x'.repeat(65536) }))
      if (mutation === 'cleanup') {
        expect(runLoopCleanup(root, { removeWorktrees: true })).toBe(0)
        expect(existsSync(record)).toBe(false)
      }
      if (mutation === 'target changed') {
        writeFileSync(join(root, 'operator.txt'), 'new target commit')
        git('add', 'operator.txt'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'operator change')
      }
      passed = true
      const result = await run()
      const recoverable = ['unchanged', 'other accepted', 'cleanup'].includes(mutation)
      expect(result.status).toBe(recoverable ? 'complete' : 'blocked')
      expect(modelCalls).toBe(mutation === 'cleanup' ? 2 : 1)
      if (recoverable) expect(readFileSync(join(root, 'implemented.txt'), 'utf8')).toBe('preserved work')
      else expect(result.reason).toMatch(/stale|ownership|Linked|large/u)
      const report = localUsageReport(root, { from: Date.now() - 60000, to: Date.now() + 60000 })
      expect(report.failures.observer).toBe(recoverable ? 1 : 2)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
