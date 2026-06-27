import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { applyActions } from '../../src/retrofit/apply.js'
import type { Action } from '../../src/retrofit/plan.js'

let target: string
const backupDir = () => join(target, '.forge', 'backup', 'test')

const actions: Action[] = [
  { kind: 'write', target: 'AGENTS.md', content: 'NEW', reason: 'baseline' },
  { kind: 'write', target: '.claude/skills/tdd/SKILL.md', content: 'SKILL', reason: 'skill: tdd' },
]

beforeEach(() => { target = mkdtempSync(join(tmpdir(), 'forge-apply-')) })
afterEach(() => { rmSync(target, { recursive: true, force: true }) })

describe('applyActions', () => {
  it('creates new files', () => {
    const res = applyActions(actions, target, { backupDir: backupDir() })
    expect(res.every(r => r.status === 'created')).toBe(true)
    expect(readFileSync(join(target, 'AGENTS.md'), 'utf8')).toBe('NEW')
    expect(existsSync(join(target, '.claude/skills/tdd/SKILL.md'))).toBe(true)
  })

  it('is idempotent — second run reports unchanged and writes no backup', () => {
    applyActions(actions, target, { backupDir: backupDir() })
    const res = applyActions(actions, target, { backupDir: backupDir() })
    expect(res.every(r => r.status === 'unchanged')).toBe(true)
    expect(existsSync(backupDir())).toBe(false)
  })

  it('backs up an existing file before overwriting with different content', () => {
    writeFileSync(join(target, 'AGENTS.md'), 'OLD')
    const res = applyActions(actions, target, { backupDir: backupDir() })
    const agents = res.find(r => r.target === 'AGENTS.md')!
    expect(agents.status).toBe('overwritten')
    expect(agents.backedUp).toBeDefined()
    expect(readFileSync(agents.backedUp!, 'utf8')).toBe('OLD')
    expect(readFileSync(join(target, 'AGENTS.md'), 'utf8')).toBe('NEW')
  })
})
