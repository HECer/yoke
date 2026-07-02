import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPrdDraft, runPrdCheck, buildPrdDraftPrompt, PRD_TEMPLATE } from '../../src/prd/command.js'
import type { Invocation } from '../../src/loop/runner.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yoke-prd-'))
  mkdirSync(join(dir, '.yoke'), { recursive: true })
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const VALID_PRD = `- id: STORY-1\n  title: scaffold project\n  priority: 1\n  acceptance:\n    - "verify command exits 0"\n  passes: false\n`

function writingRun(content: string, calls: Invocation[] = []) {
  return (inv: Invocation) => {
    calls.push(inv)
    writeFileSync(join(dir, '.yoke', 'prd.yaml'), content)
    return { success: true, summary: 'exited 0' }
  }
}

describe('buildPrdDraftPrompt', () => {
  it('contains the idea, the story band, the scaffold rule and the write-only rule', () => {
    const p = buildPrdDraftPrompt('a todo cli')
    expect(p).toContain('a todo cli')
    expect(p).toContain('5-12')
    expect(p).toContain('STORY-1')
    expect(p).toContain('.yoke/prd.yaml')
    expect(p).toContain('Do not commit')
  })
})

describe('PRD_TEMPLATE', () => {
  it('parses to an empty story array', () => {
    writeFileSync(join(dir, '.yoke', 'prd.yaml'), PRD_TEMPLATE)
    // loadPrd via runPrdCheck is Task 5; here just assert the YAML payload
    expect(PRD_TEMPLATE.trim().endsWith('[]')).toBe(true)
  })
})

describe('runPrdDraft', () => {
  it('invokes the resolved agent with the draft prompt and validates the result', () => {
    const calls: Invocation[] = []
    const code = runPrdDraft(dir, { idea: 'a todo cli', runner: 'codex', isAvailable: () => true, run: writingRun(VALID_PRD, calls) })
    expect(code).toBe(0)
    expect(calls[0].command).toBe('codex')
    expect(calls[0].input).toContain('a todo cli')
  })

  it('requires an idea', () => {
    expect(runPrdDraft(dir, { idea: '  ', isAvailable: () => true, run: writingRun(VALID_PRD) })).toBe(1)
  })

  it('returns 2 when the requested agent is unavailable', () => {
    expect(runPrdDraft(dir, { idea: 'x', runner: 'gemini', isAvailable: () => false, run: writingRun(VALID_PRD) })).toBe(2)
  })

  it('refuses to overwrite a PRD with stories unless --force', () => {
    writeFileSync(join(dir, '.yoke', 'prd.yaml'), VALID_PRD)
    expect(runPrdDraft(dir, { idea: 'x', isAvailable: () => true, run: writingRun(VALID_PRD) })).toBe(1)
    expect(runPrdDraft(dir, { idea: 'x', force: true, isAvailable: () => true, run: writingRun(VALID_PRD) })).toBe(0)
  })

  it('the template (zero stories) does not trigger the overwrite guard', () => {
    writeFileSync(join(dir, '.yoke', 'prd.yaml'), PRD_TEMPLATE)
    expect(runPrdDraft(dir, { idea: 'x', isAvailable: () => true, run: writingRun(VALID_PRD) })).toBe(0)
  })

  it('fails when the agent output is invalid YAML/schema', () => {
    expect(runPrdDraft(dir, { idea: 'x', isAvailable: () => true, run: writingRun('- id: 1\n  nope: true\n') })).toBe(1)
  })

  it('fails when the agent produces an empty PRD', () => {
    expect(runPrdDraft(dir, { idea: 'x', isAvailable: () => true, run: writingRun('[]') })).toBe(1)
  })

  it('fails when the agent run fails', () => {
    const run = (_: Invocation) => ({ success: false, summary: 'boom' })
    expect(runPrdDraft(dir, { idea: 'x', isAvailable: () => true, run })).toBe(1)
  })
})

describe('runPrdCheck', () => {
  const write = (content: string) => writeFileSync(join(dir, '.yoke', 'prd.yaml'), content)

  it('passes a valid PRD', () => {
    write(VALID_PRD)
    expect(runPrdCheck(dir)).toBe(0)
  })

  it('fails when the file is missing', () => {
    expect(runPrdCheck(dir)).toBe(1)
  })

  it('fails on schema violations', () => {
    write('- id: STORY-1\n')
    expect(runPrdCheck(dir)).toBe(1)
  })

  it('fails on duplicate ids', () => {
    write(VALID_PRD + VALID_PRD.replace('scaffold project', 'again'))
    expect(runPrdCheck(dir)).toBe(1)
  })

  it('fails on empty acceptance', () => {
    write('- id: STORY-1\n  title: t\n  priority: 1\n  acceptance: []\n  passes: false\n')
    expect(runPrdCheck(dir)).toBe(1)
  })

  it('fails on zero stories (the untouched template)', () => {
    write(PRD_TEMPLATE)
    expect(runPrdCheck(dir)).toBe(1)
  })
})
