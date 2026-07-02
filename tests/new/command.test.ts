import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runNew } from '../../src/new/command.js'
import type { Invocation } from '../../src/loop/runner.js'

const VALID_PRD = `- id: STORY-1\n  title: scaffold project\n  priority: 1\n  acceptance:\n    - "verify command exits 0"\n  passes: false\n`

let parent: string
beforeEach(() => { parent = mkdtempSync(join(tmpdir(), 'yoke-new-')) })
afterEach(() => { rmSync(parent, { recursive: true, force: true }) })

describe('runNew', () => {
  const noGit = { git: (_args: string[], _cwd: string) => {} }

  it('refuses a non-empty existing directory', () => {
    const dir = join(parent, 'app')
    mkdirSync(dir)
    writeFileSync(join(dir, 'x.txt'), 'x')
    expect(runNew(dir, { ...noGit })).toBe(1)
  })

  it('scaffolds README, .gitignore, retrofit artifacts, context and the PRD template', () => {
    const dir = join(parent, 'app')
    const gitCalls: string[][] = []
    const code = runNew(dir, { git: (args) => { gitCalls.push(args) } })
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
    runNew(dir, { ...noGit, idea: 'a todo cli', isAvailable: () => true, run: (inv: Invocation) => { writeFileSync(join(dir, '.yoke', 'prd.yaml'), VALID_PRD); return { success: true, summary: 'ok' } } })
    expect(readFileSync(join(dir, '.yoke', 'context', 'PROJECT.md'), 'utf8')).toContain('a todo cli')
  })

  it('with --idea drafts the PRD via the injected runner and commits twice', () => {
    const dir = join(parent, 'app')
    const gitCalls: string[][] = []
    const code = runNew(dir, {
      idea: 'a todo cli',
      git: (args) => { gitCalls.push(args) },
      isAvailable: () => true,
      run: (_inv: Invocation) => { writeFileSync(join(dir, '.yoke', 'prd.yaml'), VALID_PRD); return { success: true, summary: 'ok' } },
    })
    expect(code).toBe(0)
    const commits = gitCalls.filter(a => a.includes('commit'))
    expect(commits).toHaveLength(2)
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
