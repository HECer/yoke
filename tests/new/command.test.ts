import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runNew } from '../../src/new/command.js'
import type { Invocation } from '../../src/loop/runner.js'
import { loadPrd, savePrd, type Story } from '../../src/loop/prd.js'
import { readRequirements, requirementObjective } from '../../src/prd/requirements.js'
import { writeDraftCoverage } from '../prd/draft-fixture.js'

const VALID_PRD: Story[] = [{
  id: 'STORY-1', title: 'scaffold project', priority: 1, writes: ['src'], passes: false,
  acceptance: [
    { id: 'suite-runs', text: 'verify command exits 0', verify: ['npm run test:suite-runs'] },
    { id: 'app-starts', text: 'application starts', verify: ['npm run test:app-starts'] },
  ],
}]
function writeValidDraft(dir: string, invocation: Invocation) {
  savePrd(join(dir, '.yoke', 'prd.yaml'), VALID_PRD)
  writeDraftCoverage(dir, invocation, VALID_PRD)
  return { success: true, summary: 'ok' }
}

let parent: string
beforeEach(() => { parent = mkdtempSync(join(tmpdir(), 'yoke-new-')) })
afterEach(() => { rmSync(parent, { recursive: true, force: true }) })

describe('runNew', { timeout: 15_000 }, () => {
  const noGit = { git: (_args: string[], _cwd: string) => {} }

  it('refuses a non-empty existing directory', () => {
    const dir = join(parent, 'app')
    mkdirSync(dir)
    writeFileSync(join(dir, 'x.txt'), 'x')
    expect(runNew(dir, { ...noGit })).toBe(1)
  })

  it('refuses cleanly when the target is an existing file', () => {
    const file = join(parent, 'app.txt')
    writeFileSync(file, 'x')
    expect(runNew(file, { ...noGit })).toBe(1)
  })

  it('scaffolds README, .gitignore, retrofit artifacts, context and the PRD template', () => {
    const dir = join(parent, 'app')
    const gitCalls: string[][] = []
    const code = runNew(dir, { agents: ['claude'], git: (args) => { gitCalls.push(args) } })
    expect(code).toBe(0)
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toContain('# app')
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('node_modules/')
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true)              // retrofit ran
    expect(existsSync(join(dir, '.yoke', 'context', 'PROJECT.md'))).toBe(true) // context init ran
    expect(readFileSync(join(dir, '.yoke', 'prd.yaml'), 'utf8').trim().endsWith('[]')).toBe(true)
    expect(gitCalls[0]).toEqual(['init'])
    expect(gitCalls.some(a => a[0] === '-c' && a[2] === 'commit')).toBe(true) // initial commit
  })

  it('seeds PROJECT.md with the idea', () => {
    const dir = join(parent, 'app')
    expect(runNew(dir, { ...noGit, idea: 'a todo cli', isAvailable: () => true, run: inv => writeValidDraft(dir, inv) })).toBe(0)
    expect(readFileSync(join(dir, '.yoke', 'context', 'PROJECT.md'), 'utf8')).toContain('a todo cli')
  })

  it('with --idea drafts the PRD via the injected runner and commits twice', () => {
    const dir = join(parent, 'app')
    const gitCalls: string[][] = []
    const code = runNew(dir, {
      idea: 'a todo cli',
      git: (args) => { gitCalls.push(args) },
      isAvailable: () => true,
      run: inv => writeValidDraft(dir, inv),
    })
    expect(code).toBe(0)
    const commits = gitCalls.filter(a => a.includes('commit'))
    expect(commits).toHaveLength(2)
    const ledger = readRequirements(dir)!
    expect(ledger.objective).toEqual(requirementObjective('a todo cli'))
    expect(ledger.requirements.flatMap(item => item.criteria)).toEqual([
      { story: 'STORY-1', criterion: 'suite-runs' },
      { story: 'STORY-1', criterion: 'app-starts' },
    ])
    expect(loadPrd(join(dir, '.yoke', 'prd.yaml'))[0].requirementsFor).toBe(ledger.objective.sha256)
  })

  it('keeps the template and returns non-zero when the draft fails', () => {
    const dir = join(parent, 'app')
    const code = runNew(dir, {
      idea: 'a todo cli',
      ...noGit,
      isAvailable: () => true,
      run: (_inv: Invocation) => ({ success: false, summary: 'boom' }),
    })
    expect(code).toBe(1)
    expect(readFileSync(join(dir, '.yoke', 'prd.yaml'), 'utf8').trim().endsWith('[]')).toBe(true)
  })
})
