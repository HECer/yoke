import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runLoopCommand } from '../../src/loop/run-command.js'
import { readDecisionResume, writeDecisionResume } from '../../src/loop/decision.js'
import { saveConfig } from '../../src/retrofit/config.js'
import type { GitOps } from '../../src/loop/gates.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yoke-parallel-decision-'))
  mkdirSync(join(dir, '.yoke'), { recursive: true })
  saveConfig(dir, { canonVersion: 'test', agents: ['codex', 'claude'], loop: { enabled: true } })
  writeFileSync(join(dir, '.yoke', 'prd.yaml'), [
    '- { id: A, title: Architecture, priority: 1, acceptance: ["a"], passes: false, area: api }',
    '- { id: B, title: Worker, priority: 2, acceptance: ["b"], passes: false, area: web }',
    '- { id: C, title: Dependent, priority: 3, acceptance: ["c"], passes: false, needs: [A] }',
  ].join('\n'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('parallel critical decisions', () => {
  it('persists only bounded trusted resume fields and cancels sibling integration', async () => {
    const starts: string[] = []
    let integrations = 0
    const git: GitOps = {
      isClean: () => true,
      addWorktree: (_target, worktree) => {
        mkdirSync(join(worktree, '.yoke'), { recursive: true })
        writeFileSync(join(worktree, '.yoke', 'prd.yaml'), [
          '- { id: A, title: Architecture, priority: 1, acceptance: ["a"], passes: false, area: api }',
          '- { id: B, title: Worker, priority: 2, acceptance: ["b"], passes: false, area: web }',
          '- { id: C, title: Dependent, priority: 3, acceptance: ["c"], passes: false, needs: [A] }',
        ].join('\n'))
      },
      removeWorktree: (_target, worktree) => { rmSync(worktree, { recursive: true, force: true }) },
      commitAll: () => undefined,
      integrate: () => { integrations += 1 },
    }

    const code = await Promise.resolve(runLoopCommand(dir, {
      parallel: 2,
      maxIterations: 3,
      agent: 'codex',
      runner: context => {
        starts.push(context.story.id)
        if (context.story.id === 'A') {
          writeFileSync(join(context.targetDir, '.yoke', 'decision-request.yaml'), [
            'version: 1', 'storyId: A', 'question: Which public contract?', 'reason: Irreversible API choice.',
            'options:', '  - { id: A, label: Stable }', '  - { id: B, label: Experimental }', 'recommended: A', '',
          ].join('\n'))
        }
        return { success: true, summary: `${context.story.id} implemented` }
      },
      reviewer: 'claude',
      review: true,
      reviewRunner: () => ({ success: true, summary: 'approved' }),
      timeoutMinutes: 12,
      json: true,
      onAmbiguity: 'resolve',
      permissions: 'safe',
      routing: false,
      quality: true,
      qualityRounds: 7,
      qualityMinutes: 12,
      qualityPolicy: 'advisory',
      qualityUnbounded: true,
      candidates: 1,
      git,
      verify: () => ({ passed: true, summary: 'green' }),
    }))

    const resume = readDecisionResume(dir)
    expect(code).toBe(1)
    expect(starts).toContain('A')
    expect(starts).not.toContain('C')
    expect(integrations).toBe(0)
    expect(resume).toMatchObject({
      version: 1,
      storyId: 'A',
      answered: false,
      maxIterations: 3,
      agent: 'codex',
      isolate: true,
      reviewer: 'claude',
      review: true,
      allowSelfReview: false,
      timeoutMinutes: 12,
      json: true,
      onAmbiguity: 'resolve',
      permissions: 'safe',
      parallel: 2,
      routing: false,
      quality: true,
      qualityRounds: 7,
      qualityMinutes: 12,
      qualityPolicy: 'advisory',
      candidates: 1,
    })
    expect(Object.keys(resume ?? {}).sort()).toEqual([
      'agent', 'allowSelfReview', 'answered', 'candidates', 'isolate', 'json', 'maxIterations',
      'onAmbiguity', 'parallel', 'permissions', 'prdHash', 'projectId', 'quality', 'qualityMinutes',
      'qualityPolicy', 'qualityRounds', 'requestId', 'review', 'reviewer', 'routing', 'storyId',
      'timeoutMinutes', 'version',
    ].sort())
    expect(resume).not.toHaveProperty('qualityUnbounded')
  }, 15_000)

  it('clears trusted resume state after a successful parallel decision resume', async () => {
    writeDecisionResume(dir, {
      version: 1,
      storyId: 'A',
      requestId: 'a'.repeat(16),
      answered: true,
      isolate: true,
      review: false,
      allowSelfReview: false,
      json: false,
      permissions: 'safe',
      parallel: 2,
      routing: false,
    })
    const git: GitOps = {
      isClean: () => true,
      addWorktree: (_target, worktree) => {
        mkdirSync(join(worktree, '.yoke'), { recursive: true })
        writeFileSync(join(worktree, '.yoke', 'prd.yaml'), readFileSync(join(dir, '.yoke', 'prd.yaml'), 'utf8'))
      },
      removeWorktree: (_target, worktree) => { rmSync(worktree, { recursive: true, force: true }) },
      commitAll: () => undefined,
      integrate: (_target, worktree) => {
        writeFileSync(join(dir, '.yoke', 'prd.yaml'), readFileSync(join(worktree, '.yoke', 'prd.yaml'), 'utf8'))
      },
    }

    const code = await Promise.resolve(runLoopCommand(dir, {
      parallel: 2,
      maxIterations: 3,
      runner: () => ({ success: true, summary: 'implemented' }),
      git,
      verify: () => ({ passed: true, summary: 'green' }),
    }))

    expect(code).toBe(0)
    expect(readDecisionResume(dir)).toBeNull()
  })
})
