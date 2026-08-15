import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startProviderProcess } from '../../src/agents/providers.js'
import { runLoopCommand } from '../../src/loop/run-command.js'
import { loadPrd } from '../../src/loop/prd.js'
import { YOKE_IGNORE_LINES } from '../../src/retrofit/gitignore.js'
import { saveConfig } from '../../src/retrofit/config.js'

const { makeAsyncRunner } = vi.hoisted(() => ({ makeAsyncRunner: vi.fn() }))

vi.mock('../../src/loop/runner.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/loop/runner.js')>(),
  makeAsyncRunner,
}))

type StorySpec = { readonly id: string; readonly needs?: readonly string[] }
type Project = { readonly dir: string; readonly barrier: string; readonly criterionLog: string; readonly baseCommit: string }

const projects: string[] = []
const providerProcesses: Array<ReturnType<typeof startProviderProcess>> = []

afterEach(async () => {
  makeAsyncRunner.mockReset()
  const active = providerProcesses.splice(0)
  for (const process of active) process.cancel('test teardown')
  await Promise.all(active.map(process => process.completion))
  for (const dir of projects.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Phase 5 parallel integration', { timeout: 30_000 }, () => {
  it('runs two provider subprocesses through the three-story DAG and every worker plus integration gate', async () => {
    const project = createProject([{ id: 'A' }, { id: 'B' }, { id: 'C', needs: ['A', 'B'] }], true)
    const starts: string[] = []
    const dependentPrerequisites: string[][] = []
    useProviderProcesses(project, 'dag', starts, dependentPrerequisites)
    const gates = { verify: 0, perf: 0, audit: 0 }
    let qualityCalls = 0
    let reviewCalls = 0

    const code = await Promise.resolve(runLoopCommand(project.dir, {
      parallel: 2,
      maxIterations: 3,
      isAvailable: () => true,
      commitIdentity: identity,
      verify: () => ({ passed: true, summary: `verify ${++gates.verify}` }),
      perf: () => ({ passed: true, summary: `perf ${++gates.perf}` }),
      audit: () => ({ passed: true, summary: `audit ${++gates.audit}` }),
      reviewRunner: () => ({ success: true, summary: `review ${++reviewCalls}` }),
      qualityRuntime: {
        invoke: (_agent, invocation) => {
          qualityCalls += 1
          const request = JSON.parse(invocation.input) as { attemptId: string; candidateLabel: 'A' | 'B'; promptDigest: string; rubricDigest: string }
          const attemptId = request.attemptId
          const label = request.candidateLabel
          if (label !== 'A' && label !== 'B') throw new Error(`unexpected quality label ${label}`)
          return { success: true, output: qualityVerdict(attemptId, label, request.promptDigest, request.rubricDigest), summary: 'critic approved' }
        },
        firstLabel: () => 'A',
      },
    }))

    expect(code).toBe(0)
    expect(readFileSync(join(project.barrier, 'overlap'), 'utf8')).toMatch(/[AB]/)
    expect(starts.slice(0, 2).sort()).toEqual(['A', 'B'])
    expect(starts).toEqual(['A', 'B', 'C'])
    expect(dependentPrerequisites).toEqual([['A', 'B']])
    expect(readFileSync(project.criterionLog, 'utf8').split('|').filter(Boolean)).toHaveLength(12)
    expect(gates).toEqual({ verify: 6, perf: 6, audit: 6 })
    expect(qualityCalls).toBe(12)
    expect(reviewCalls).toBe(6)
    expect(loadPrd(join(project.dir, '.yoke', 'prd.yaml')).every(story => story.passes)).toBe(true)
    expect(git(project.dir, ['rev-list', '--count', `${project.baseCommit}..HEAD`])).toBe('3')
    expect(git(project.dir, ['status', '--porcelain'])).toBe('')
    expect(runtimeEntries(project.dir, 'claims')).toEqual([])
    expect(runtimeEntries(project.dir, 'provider-processes')).toEqual([])
    expect(runtimeEntries(project.dir, 'worktrees')).toEqual([])
    expect(git(project.dir, ['worktree', 'list', '--porcelain']).match(/^worktree /gmu)).toHaveLength(1)
  })

  it('reopens a real conflicting candidate without marking it passed', async () => {
    const project = createProject([{ id: 'A' }, { id: 'B' }, { id: 'C', needs: ['A', 'B'] }], false)
    mkdirSync(project.barrier, { recursive: true })
    const starts: string[] = []
    const prerequisites: string[][] = []

    const code = await Promise.resolve(runLoopCommand(project.dir, {
      parallel: 2,
      maxIterations: 2,
      commitIdentity: identity,
      runner: context => {
        starts.push(context.story.id)
        writeFileSync(join(context.targetDir, 'shared.txt'), context.story.id)
        return { success: true, summary: `${context.story.id} implemented` }
      },
      verify: () => ({ passed: true, summary: 'green' }),
    }))

    const stories = loadPrd(join(project.dir, '.yoke', 'prd.yaml'))
    expect(code).toBe(1)
    expect(starts).toEqual(['A', 'B'])
    expect(prerequisites).toEqual([])
    expect(stories.map(story => [story.id, story.passes])).toEqual([['A', true], ['B', false], ['C', false]])
    expect(git(project.dir, ['rev-list', '--count', `${project.baseCommit}..HEAD`])).toBe('1')
    expect(git(project.dir, ['status', '--porcelain'])).toBe('')
    expect(runtimeEntries(project.dir, 'claims')).toEqual([])
    expect(runtimeEntries(project.dir, 'provider-processes')).toEqual([])
    expect(runtimeEntries(project.dir, 'worktrees')).toEqual([])
  })

  it('fails closed on a dirty target before dispatching workers', async () => {
    const project = createProject([{ id: 'A' }], false)
    writeFileSync(join(project.dir, 'candidate.txt'), 'operator edit')
    let workers = 0

    const code = await Promise.resolve(runLoopCommand(project.dir, {
      parallel: 2,
      maxIterations: 1,
      commitIdentity: identity,
      runner: () => { workers += 1; return { success: true, summary: 'unexpected' } },
      verify: () => ({ passed: true, summary: 'green' }),
    }))

    expect(code).toBe(1)
    expect(workers).toBe(0)
    expect(loadPrd(join(project.dir, '.yoke', 'prd.yaml'))[0]?.passes).toBe(false)
  })
})

const identity = { authorName: 'Test User', authorEmail: 'test@example.com', allowCoAuthors: false }

function createProject(stories: readonly StorySpec[], quality: boolean): Project {
  const dir = mkdtempSync(join(tmpdir(), 'yoke-phase-five-'))
  const barrier = join(dir, '.yoke', 'proof', 'phase-five-barrier')
  const criterionLog = join(dir, '.yoke', 'proof', 'criteria.log')
  projects.push(dir)
  mkdirSync(join(dir, '.yoke'), { recursive: true })
  writeFileSync(join(dir, 'reference.txt'), 'trusted reference')
  writeFileSync(join(dir, 'candidate.txt'), 'candidate artifact')
  saveConfig(dir, {
    canonVersion: 'test', agents: ['codex'], loop: { enabled: true },
    verify: { command: 'node -e "process.exit(0)"', requireCriteria: true },
    ...(quality ? { quality: { enabled: true, policy: 'blocking', maxRounds: 1, maxMinutes: 1, consistencyChecks: 2, maxParallelCandidates: 1, criticAgent: 'codex', criticModel: 'test-critic' } } : {}),
  })
  writeFileSync(join(dir, '.yoke', 'prd.yaml'), stories.map(story => storyYaml(story, criterionLog, quality)).join('\n'))
  writeFileSync(join(dir, '.gitignore'), `${YOKE_IGNORE_LINES.join('\n')}\n`)
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' })
  execFileSync('git', ['config', 'user.name', identity.authorName], { cwd: dir, stdio: 'pipe' })
  execFileSync('git', ['config', 'user.email', identity.authorEmail], { cwd: dir, stdio: 'pipe' })
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' })
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir, stdio: 'pipe' })
  return { dir, barrier, criterionLog, baseCommit: git(dir, ['rev-parse', 'HEAD']) }
}

function storyYaml(story: StorySpec, criterionLog: string, quality: boolean): string {
  const criterion = (suffix: string): string => {
    const id = `criterion-${story.id}-${suffix}`
    const command = `node -e ${JSON.stringify(`require('node:fs').appendFileSync(${JSON.stringify(criterionLog)}, '${id}|')`)}`
    return `    - id: ${id}\n      text: ${story.id} ${suffix} works\n      verify: [${JSON.stringify(command)}]\n`
  }
  const needs = story.needs?.length ? `  needs: [${story.needs.join(', ')}]\n` : ''
  const qualityBlock = quality ? `  quality:\n    reference: { name: approved-reference, source: reference.txt, kind: file, digest: sha256:${digest('trusted reference')} }\n    candidate: { kind: files, paths: [candidate.txt] }\n    rubric: Compare candidate with reference\n` : ''
  return `- id: ${story.id}\n  title: ${story.id} story\n  priority: 1\n  acceptance:\n${criterion('one')}${criterion('two')}${needs}  passes: false\n${qualityBlock}`
}

function useProviderProcesses(project: Project, mode: 'dag' | 'conflict', starts: string[], prerequisites: string[][]): void {
  makeAsyncRunner.mockImplementation((agent, options) => context => {
    starts.push(context.story.id)
    if (context.story.id === 'C') prerequisites.push(loadPrd(join(context.targetDir, '.yoke', 'prd.yaml')).filter(story => story.passes).map(story => story.id).sort())
    const handle = startProviderProcess(agent, { command: process.execPath, args: ['--eval', providerScript(context.story.id, project.barrier, mode)], input: '', cwd: context.targetDir }, options.process)
    providerProcesses.push(handle)
    return handle
  })
}

function providerScript(id: string, barrier: string, mode: 'dag' | 'conflict'): string {
  const completion = mode === 'conflict' ? "fs.writeFileSync('shared.txt', id)" : "fs.writeFileSync(`implemented-${id}.txt`, id)"
  return `const fs=require('node:fs');const path=require('node:path');const id=${JSON.stringify(id)};const barrier=${JSON.stringify(barrier)};const finish=()=>{${completion};process.stdout.write('done\\n')};const waitFor=(file,done)=>{if(fs.existsSync(file))return done();const watcher=fs.watch(barrier,()=>{if(fs.existsSync(file)){watcher.close();done()}});if(fs.existsSync(file)){watcher.close();done()}};if(id!=='A'&&id!=='B')finish();else{fs.mkdirSync(barrier,{recursive:true});fs.writeFileSync(path.join(barrier,id),'');const ready=()=>fs.existsSync(path.join(barrier,'A'))&&fs.existsSync(path.join(barrier,'B'));const release=()=>{if(!ready())return false;fs.writeFileSync(path.join(barrier,'overlap'),id);if(${JSON.stringify(mode)}==='conflict'&&id==='B')waitFor(path.join(barrier,'release-B'),finish);else finish();return true};if(!release()){const watcher=fs.watch(barrier,()=>{if(release())watcher.close()});if(release())watcher.close()}}`
}

function qualityVerdict(attemptId: string, label: 'A' | 'B', promptDigest: string, rubricDigest: string): string {
  return JSON.stringify({ schemaVersion: 1, attemptId, winner: 'candidate', biggestGap: 'none', evidence: ['candidate matches reference'], confidence: 'high', candidate: { label, digest: digest('candidate artifact') }, reference: { label: label === 'A' ? 'B' : 'A', digest: digest('trusted reference') }, provenance: { provider: 'codex', model: 'test-critic', promptDigest, rubricDigest, referenceDigest: digest('trusted reference'), candidateDigest: digest('candidate artifact') } })
}

function capture(input: string, pattern: RegExp): string { return pattern.exec(input)?.[1] ?? (() => { throw new Error(`missing ${pattern}`) })() }
function digest(value: string): string { return createHash('sha256').update(value).digest('hex') }
function git(dir: string, args: string[]): string { return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim() }
function runtimeEntries(dir: string, name: string): string[] { const path = join(dir, '.yoke', name); return existsSync(path) ? readdirSync(path) : [] }
