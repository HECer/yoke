import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runLoopCommand } from '../../src/loop/run-command.js'
import { loadPrd, savePrd, type Story } from '../../src/loop/prd.js'
import { saveConfig } from '../../src/retrofit/config.js'
import type { AgentRunner } from '../../src/loop/runner.js'
import type { GitOps } from '../../src/loop/gates.js'
import type { Verifier } from '../../src/loop/verify.js'
import type { ModelSelection } from '../../src/agents/types.js'

const { makeAsyncRunner } = vi.hoisted(() => ({ makeAsyncRunner: vi.fn() }))

vi.mock('../../src/loop/runner.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/loop/runner.js')>(),
  makeAsyncRunner,
}))

let dir: string

const verifyOk: Verifier = () => ({ passed: true, summary: 'green' })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yoke-parallel-cli-'))
  mkdirSync(join(dir, '.yoke'), { recursive: true })
  saveConfig(dir, {
    canonVersion: '0.1.0',
    agents: ['claude'],
    loop: { enabled: true },
    verify: { command: 'node -e "process.exit(0)"' },
  })
  writeFileSync(join(dir, '.yoke', 'prd.yaml'), [
    '- { id: A, title: API, priority: 1, acceptance: ["a"], passes: false, area: api }',
    '- { id: B, title: Web, priority: 2, acceptance: ["b"], passes: false, area: web }',
    '- { id: C, title: Depends, priority: 3, acceptance: ["c"], passes: false, needs: [A] }',
  ].join('\n'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('yoke loop run --parallel', () => {
  it('runs affinity stories with their configured provider model while no-affinity stories keep the global provider', async () => {
    const calls: Array<{ agent: string; selection: ModelSelection | undefined }> = []
    makeAsyncRunner.mockImplementation((agent, options) => {
      calls.push({ agent, selection: options.selection })
      return context => ({
        pid: undefined,
        invocation: { command: agent, args: [], input: '', cwd: context.targetDir },
        recordPath: '',
        completion: Promise.resolve({
          kind: 'succeeded' as const,
          exitCode: 0 as const,
          invocation: { command: agent, args: [], input: '', cwd: context.targetDir },
          pid: undefined,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          telemetry: { usageAvailable: false },
        }),
        cancel: () => false,
      })
    })
    saveConfig(dir, {
      canonVersion: '0.1.0',
      agents: ['claude', 'codex'],
      loop: { enabled: true },
      runner: { agent: 'claude', model: 'claude-global', reasoningEffort: 'high' },
      routing: {
        enabled: false,
        strategy: 'balanced',
        maxCandidates: 3,
        workers: [{ id: 'codex-story-worker', agent: 'codex', model: 'codex-story-model', reasoningEffort: 'medium', costTier: 'medium', capabilities: [] }],
      },
      verify: { command: 'node -e "process.exit(0)"' },
    })
    writeFileSync(join(dir, '.yoke', 'prd.yaml'), [
      '- { id: A, title: API, priority: 1, acceptance: ["a"], passes: false, agent: codex }',
      '- { id: B, title: Web, priority: 2, acceptance: ["b"], passes: false }',
    ].join('\n'))
    const code = await Promise.resolve(runLoopCommand(dir, {
      parallel: 2,
      maxIterations: 2,
      git: parallelGit(),
      verify: verifyOk,
      isAvailable: () => true,
    }))

    expect(code).toBe(0)
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ agent: 'codex', selection: expect.objectContaining({ model: 'codex-story-model', reasoningEffort: 'medium' }) }),
      expect.objectContaining({ agent: 'claude', selection: expect.objectContaining({ model: 'claude-global', reasoningEffort: 'high' }) }),
    ]))
    expect(loadPrd(join(dir, '.yoke', 'prd.yaml')).every(story => story.passes)).toBe(true)
  })

  it('preflights each required affinity provider before any parallel worker starts', async () => {
    const availabilityChecks: string[] = []
    let workerStarts = 0
    makeAsyncRunner.mockImplementation(() => {
      workerStarts += 1
      throw new Error('workers must not start when preflight fails')
    })
    saveConfig(dir, {
      canonVersion: '0.1.0',
      agents: ['claude', 'codex'],
      loop: { enabled: true },
      runner: { agent: 'claude' },
      verify: { command: 'node -e "process.exit(0)"' },
    })
    writeFileSync(join(dir, '.yoke', 'prd.yaml'), [
      '- { id: A, title: API, priority: 1, acceptance: ["a"], passes: false }',
      '- { id: B, title: Web, priority: 2, acceptance: ["b"], passes: false, agent: codex }',
    ].join('\n'))

    const code = await Promise.resolve(runLoopCommand(dir, {
      parallel: 2,
      maxIterations: 2,
      git: cleanGit(),
      verify: verifyOk,
      isAvailable: agent => {
        availabilityChecks.push(agent)
        return agent !== 'codex'
      },
    }))

    expect(code).toBe(2)
    expect(availabilityChecks).toEqual(['claude', 'codex'])
    expect(workerStarts).toBe(0)
  })

  it('rejects parallel routing before the direct worker path can bypass adaptive selection', async () => {
    saveConfig(dir, {
      canonVersion: '0.1.0',
      agents: ['claude'],
      loop: { enabled: true },
      routing: {
        enabled: true,
        strategy: 'balanced',
        maxCandidates: 1,
        workers: [{ id: 'claude-worker', agent: 'claude', costTier: 'medium', capabilities: [] }],
      },
      verify: { command: 'node -e "process.exit(0)"' },
    })
    let starts = 0

    const code = await Promise.resolve(runLoopCommand(dir, {
      parallel: 2,
      maxIterations: 1,
      runner: () => { starts += 1; return { success: true, summary: 'unexpected' } },
      git: parallelGit(),
      verify: verifyOk,
    }))

    expect(code).toBe(2)
    expect(starts).toBe(0)
  })

  it('rejects duplicate affinity profiles for one provider before parallel dispatch', async () => {
    saveConfig(dir, {
      canonVersion: '0.1.0',
      agents: ['claude', 'codex'],
      loop: { enabled: true },
      routing: {
        enabled: false,
        strategy: 'balanced',
        maxCandidates: 3,
        workers: [
          { id: 'codex-first', agent: 'codex', model: 'first-model', costTier: 'medium', capabilities: [] },
          { id: 'codex-second', agent: 'codex', model: 'second-model', costTier: 'medium', capabilities: [] },
        ],
      },
      verify: { command: 'node -e "process.exit(0)"' },
    })
    writeFileSync(join(dir, '.yoke', 'prd.yaml'), '- { id: A, title: API, priority: 1, acceptance: ["a"], passes: false, agent: codex }')
    let starts = 0

    const code = await Promise.resolve(runLoopCommand(dir, {
      parallel: 2,
      maxIterations: 1,
      runner: () => { starts += 1; return { success: true, summary: 'unexpected' } },
      git: parallelGit(),
      verify: verifyOk,
    }))

    expect(code).toBe(2)
    expect(starts).toBe(0)
  })

  it('rejects an injected runner when affinity differs from the configured global provider', async () => {
    saveConfig(dir, {
      canonVersion: '0.1.0',
      agents: ['claude', 'codex'],
      loop: { enabled: true },
      runner: { agent: 'claude', model: 'claude-global' },
      verify: { command: 'node -e "process.exit(0)"' },
    })
    writeFileSync(join(dir, '.yoke', 'prd.yaml'), '- { id: A, title: API, priority: 1, acceptance: ["a"], passes: false, agent: codex }')
    let starts = 0

    const code = await Promise.resolve(runLoopCommand(dir, {
      parallel: 2,
      maxIterations: 1,
      runner: () => { starts += 1; return { success: true, summary: 'unexpected' } },
      git: parallelGit(),
      verify: verifyOk,
    }))

    expect(code).toBe(2)
    expect(starts).toBe(0)
  })

  it('allows an injected runner when affinity agrees with the configured global provider', async () => {
    saveConfig(dir, {
      canonVersion: '0.1.0',
      agents: ['claude'],
      loop: { enabled: true },
      runner: { agent: 'claude', model: 'claude-global' },
      verify: { command: 'node -e "process.exit(0)"' },
    })
    writeFileSync(join(dir, '.yoke', 'prd.yaml'), '- { id: A, title: API, priority: 1, acceptance: ["a"], passes: false, agent: claude }')
    let starts = 0

    const code = await Promise.resolve(runLoopCommand(dir, {
      parallel: 2,
      maxIterations: 1,
      runner: () => { starts += 1; return { success: true, summary: 'implemented' } },
      git: parallelGit(),
      verify: verifyOk,
    }))

    expect(code).toBe(0)
    expect(starts).toBe(1)
  })

  it('integrates two isolated workers before releasing a dependent story', async () => {
    const starts: string[] = []
    const worktrees: string[] = []
    const runner: AgentRunner = context => {
      starts.push(context.story.id)
      return { success: true, summary: `${context.story.id} implemented` }
    }
    const git: GitOps = {
      isClean: () => true,
      addWorktree: (_target, worktree) => {
        worktrees.push(worktree)
        mkdirSync(join(worktree, '.yoke'), { recursive: true })
        writeFileSync(join(worktree, '.yoke', 'prd.yaml'), writePrd())
      },
      removeWorktree: (_target, worktree) => {
        rmSync(worktree, { recursive: true, force: true })
      },
      commitAll: () => undefined,
      integrate: (_target, worktree) => {
        const candidate = loadPrd(join(worktree, '.yoke', 'prd.yaml'))
        savePrd(join(dir, '.yoke', 'prd.yaml'), candidate)
      },
    }

    const code = await Promise.resolve(runLoopCommand(dir, {
      parallel: 2,
      maxIterations: 3,
      runner,
      git,
      verify: verifyOk,
    }))

    expect(code).toBe(0)
    expect(starts.slice(0, 2).sort()).toEqual(['A', 'B'])
    expect(starts).toEqual(['A', 'B', 'C'])
    expect(new Set(worktrees).size).toBe(3)
    expect(loadPrd(join(dir, '.yoke', 'prd.yaml')).every(story => story.passes)).toBe(true)
  })

  it('consumes a pause request before launching a worker', async () => {
    writeFileSync(join(dir, '.yoke', 'loop.pause'), '')
    const code = await Promise.resolve(runLoopCommand(dir, {
      parallel: 2,
      runner: () => { throw new Error('runner must not start while paused') },
      git: cleanGit(),
      verify: verifyOk,
    }))

    expect(code).toBe(3)
    expect(existsSync(join(dir, '.yoke', 'loop.pause'))).toBe(false)
  })

  it('uses real Git worktrees to serialize three dependent story commits', { timeout: 15_000 }, async () => {
    for (const id of ['A', 'B', 'C']) writeFileSync(join(dir, `implemented-${id}.txt`), `base ${id}`)
    const baseCommit = initializeGitRepository([
      '- { id: A, title: API, priority: 1, acceptance: ["a"], passes: false, area: api }',
      '- { id: B, title: Web, priority: 2, acceptance: ["b"], passes: false, area: web }',
      '- { id: C, title: Depends, priority: 3, acceptance: ["c"], passes: false, needs: [A, B] }',
    ].join('\n'))
    const preRebaseHook = join(dir, '.git', 'hooks', 'pre-rebase')
    writeFileSync(preRebaseHook, '#!/bin/sh\nexit 1\n')
    chmodSync(preRebaseHook, 0o755)

    const code = await Promise.resolve(runLoopCommand(dir, {
      parallel: 2,
      maxIterations: 3,
      runner: context => {
        writeFileSync(join(context.targetDir, `implemented-${context.story.id}.txt`), context.story.id)
        if (context.story.id === 'B') {
          execFileSync('git', ['add', 'implemented-B.txt'], { cwd: context.targetDir, stdio: 'pipe' })
          execFileSync('git', ['commit', '-m', 'worker: intermediate B'], { cwd: context.targetDir, stdio: 'pipe' })
          writeFileSync(join(context.targetDir, 'implemented-B.txt'), 'dirty B')
          writeFileSync(join(context.targetDir, 'untracked-B.txt'), 'untracked B')
        }
        return { success: true, summary: 'implemented' }
      },
      verify: verifyOk,
      commitIdentity: { authorName: 'Test User', authorEmail: 'test@example.com', allowCoAuthors: false },
    }))

    expect(code).toBe(0)
    expect(['A', 'B', 'C'].every(id => existsSync(join(dir, `implemented-${id}.txt`)))).toBe(true)
    expect(loadPrd(join(dir, '.yoke', 'prd.yaml')).every(story => story.passes)).toBe(true)
    expect(execFileSync('git', ['rev-list', '--count', `${baseCommit}..HEAD`], { cwd: dir, encoding: 'utf8' }).trim()).toBe('3')
    expect(['A', 'B', 'C'].map(id => readFileSync(join(dir, `implemented-${id}.txt`), 'utf8'))).toEqual(['A', 'dirty B', 'C'])
    expect(readFileSync(join(dir, 'untracked-B.txt'), 'utf8')).toBe('untracked B')
    expect(execFileSync('git', ['log', '--format=%s', `${baseCommit}..HEAD`], { cwd: dir, encoding: 'utf8' })).not.toMatch(/temporary candidate|worker: intermediate B/)
    expect(readdirSync(join(dir, '.yoke', 'worktrees'))).toEqual([])
    expect(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: dir, encoding: 'utf8' }).match(/^worktree /gmu)).toHaveLength(1)
  })

  it('keeps unrelated PRD stories authoritative when a worker mutates its candidate copy', async () => {
    initializeGitRepository([
      '- { id: A, title: API, priority: 1, acceptance: ["a"], passes: false, area: api }',
      '- { id: B, title: Web, priority: 2, acceptance: ["b"], passes: false, needs: [A] }',
    ].join('\n'))

    const code = await Promise.resolve(runLoopCommand(dir, {
      parallel: 2,
      maxIterations: 1,
      runner: context => {
        writeFileSync(join(context.targetDir, 'implemented-A.txt'), 'candidate source')
        const candidatePrdPath = join(context.targetDir, '.yoke', 'prd.yaml')
        const candidateStories = loadPrd(candidatePrdPath).map(story => story.id === 'B'
          ? { ...story, title: 'Worker rewrote B', passes: true }
          : story)
        savePrd(candidatePrdPath, candidateStories)
        return { success: true, summary: 'implemented' }
      },
      verify: verifyOk,
      commitIdentity: { authorName: 'Test User', authorEmail: 'test@example.com', allowCoAuthors: false },
    }))

    const targetStories = loadPrd(join(dir, '.yoke', 'prd.yaml'))
    expect(code).toBe(1)
    expect(targetStories.find(story => story.id === 'A')?.passes).toBe(true)
    expect(targetStories.find(story => story.id === 'B')).toMatchObject({ title: 'Web', passes: false })
    expect(existsSync(join(dir, 'implemented-A.txt'))).toBe(true)
  })

  it('lands a worker-authored commit as one dispatcher-authored story commit', async () => {
    const baseCommit = initializeGitRepository('- { id: A, title: API, priority: 1, acceptance: ["a"], passes: false }')

    const code = await Promise.resolve(runLoopCommand(dir, {
      parallel: 2,
      maxIterations: 1,
      runner: context => {
        writeFileSync(join(context.targetDir, 'implemented-A.txt'), 'candidate source')
        execFileSync('git', ['add', 'implemented-A.txt'], { cwd: context.targetDir, stdio: 'pipe' })
        execFileSync('git', ['commit', '-m', 'worker: unauthorized history'], { cwd: context.targetDir, stdio: 'pipe' })
        return { success: true, summary: 'implemented' }
      },
      verify: verifyOk,
      commitIdentity: { authorName: 'Test User', authorEmail: 'test@example.com', allowCoAuthors: false },
    }))

    const landedSubjects = execFileSync('git', ['log', '--format=%s', `${baseCommit}..HEAD`], { cwd: dir, encoding: 'utf8' }).trim().split('\n')
    expect(code).toBe(0)
    expect(existsSync(join(dir, 'implemented-A.txt'))).toBe(true)
    expect(landedSubjects).toEqual(['yoke: complete A API'])
  })

  it('does not integrate when the target becomes dirty during integrated gates', async () => {
    writeFileSync(join(dir, 'tracked.txt'), 'operator baseline')
    const expectedHead = initializeGitRepository('- { id: A, title: API, priority: 1, acceptance: ["a"], passes: false }')
    let verifyCalls = 0

    const code = await Promise.resolve(runLoopCommand(dir, {
      parallel: 2,
      maxIterations: 1,
      runner: context => {
        writeFileSync(join(context.targetDir, 'implemented-A.txt'), 'candidate source')
        return { success: true, summary: 'implemented' }
      },
      verify: () => {
        verifyCalls += 1
        if (verifyCalls === 2) writeFileSync(join(dir, 'tracked.txt'), 'operator edit during gates')
        return { passed: true, summary: 'green' }
      },
      commitIdentity: { authorName: 'Test User', authorEmail: 'test@example.com', allowCoAuthors: false },
    }))

    expect(code).toBe(1)
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()).toBe(expectedHead)
    expect(readFileSync(join(dir, 'tracked.txt'), 'utf8')).toBe('operator edit during gates')
    expect(existsSync(join(dir, 'implemented-A.txt'))).toBe(false)
  })

  it('does not integrate when the target rewinds during integrated gates', async () => {
    const expectedHead = initializeGitRepository('- { id: A, title: API, priority: 1, acceptance: ["a"], passes: false }')
    const rewoundHead = execFileSync('git', ['rev-parse', `${expectedHead}^`], { cwd: dir, encoding: 'utf8' }).trim()
    let verifyCalls = 0

    const code = await Promise.resolve(runLoopCommand(dir, {
      parallel: 2,
      maxIterations: 1,
      runner: context => {
        writeFileSync(join(context.targetDir, 'implemented-A.txt'), 'candidate source')
        return { success: true, summary: 'implemented' }
      },
      verify: () => {
        verifyCalls += 1
        if (verifyCalls === 2) execFileSync('git', ['reset', '--hard', rewoundHead], { cwd: dir, stdio: 'pipe' })
        return { passed: true, summary: 'green' }
      },
      commitIdentity: { authorName: 'Test User', authorEmail: 'test@example.com', allowCoAuthors: false },
    }))

    expect(code).toBe(1)
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()).toBe(rewoundHead)
    expect(existsSync(join(dir, 'implemented-A.txt'))).toBe(false)
  })
})

function cleanGit(): GitOps {
  return {
    isClean: () => true,
    addWorktree: () => undefined,
    removeWorktree: () => undefined,
    commitAll: () => undefined,
    integrate: () => undefined,
  }
}

function parallelGit(): GitOps {
  return {
    isClean: () => true,
    addWorktree: (_target, worktree) => {
      mkdirSync(join(worktree, '.yoke'), { recursive: true })
      writeFileSync(join(worktree, '.yoke', 'prd.yaml'), readFileSync(join(dir, '.yoke', 'prd.yaml'), 'utf8'))
    },
    removeWorktree: (_target, worktree) => { rmSync(worktree, { recursive: true, force: true }) },
    commitAll: () => undefined,
    integrate: (_target, worktree) => {
      savePrd(join(dir, '.yoke', 'prd.yaml'), loadPrd(join(worktree, '.yoke', 'prd.yaml')))
    },
  }
}

function writePrd(): string {
  return [
    '- { id: A, title: API, priority: 1, acceptance: ["a"], passes: false, area: api }',
    '- { id: B, title: Web, priority: 2, acceptance: ["b"], passes: false, area: web }',
    '- { id: C, title: Depends, priority: 3, acceptance: ["c"], passes: false, needs: [A] }',
  ].join('\n')
}

function initializeGitRepository(prd: string): string {
  writeFileSync(join(dir, '.gitignore'), '.yoke/worktrees/\n.yoke/claims/\n.yoke/loop.lock\n.yoke/loop-status.json\n.yoke/loop.log\n')
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' })
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'pipe' })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'pipe' })
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' })
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir, stdio: 'pipe' })
  writeFileSync(join(dir, '.yoke', 'prd.yaml'), prd)
  execFileSync('git', ['add', '.yoke/prd.yaml'], { cwd: dir, stdio: 'pipe' })
  execFileSync('git', ['commit', '-m', 'add story'], { cwd: dir, stdio: 'pipe' })
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
}
