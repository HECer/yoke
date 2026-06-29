import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { applyActions } from '../../src/retrofit/apply.js'
import type { Action } from '../../src/retrofit/plan.js'

let target: string
const backupDir = () => join(target, '.yoke', 'backup', 'test')

const actions: Action[] = [
  { kind: 'write', target: 'AGENTS.md', content: 'NEW', reason: 'baseline' },
  { kind: 'write', target: '.claude/skills/tdd/SKILL.md', content: 'SKILL', reason: 'skill: tdd' },
]

beforeEach(() => { target = mkdtempSync(join(tmpdir(), 'yoke-apply-')) })
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

  it('merges a merge-flagged JSON action into an existing file, preserving user keys', () => {
    writeFileSync(join(target, 'settings.json'), JSON.stringify({ model: 'opus', hooks: { A: [1] } }))
    const mergeAction: Action = {
      kind: 'write', target: 'settings.json', merge: true,
      content: JSON.stringify({ hooks: { A: [1], B: [2] } }), reason: 'settings',
    }
    const res = applyActions([mergeAction], target, { backupDir: backupDir() })
    expect(res[0].status).toBe('merged')
    expect(res[0].backedUp).toBeDefined()
    const written = JSON.parse(readFileSync(join(target, 'settings.json'), 'utf8'))
    expect(written.model).toBe('opus')          // user key preserved
    expect(written.hooks.A).toEqual([1])         // de-duped, not [1,1]
    expect(written.hooks.B).toEqual([2])         // ours added
  })

  it('treats a merge action as a plain create when the file does not exist', () => {
    const mergeAction: Action = {
      kind: 'write', target: 'fresh.json', merge: true,
      content: JSON.stringify({ a: 1 }), reason: 'x',
    }
    const res = applyActions([mergeAction], target, { backupDir: backupDir() })
    expect(res[0].status).toBe('created')
    expect(JSON.parse(readFileSync(join(target, 'fresh.json'), 'utf8'))).toEqual({ a: 1 })
  })

  it('throws a clear error when the existing file to merge is not valid JSON', () => {
    writeFileSync(join(target, 'settings.json'), '{ not json')
    const mergeAction: Action = {
      kind: 'write', target: 'settings.json', merge: true,
      content: JSON.stringify({ a: 1 }), reason: 'settings',
    }
    expect(() => applyActions([mergeAction], target, { backupDir: backupDir() })).toThrow(/not valid JSON/)
  })

  it('ifAbsent action creates the file when missing', () => {
    const d = mkdtempSync(join(tmpdir(), 'yoke-apply-'))
    const res = applyActions(
      [{ kind: 'write', target: '.yoke/context/PROJECT.md', content: 'TEMPLATE', reason: 'scaffold', ifAbsent: true }],
      d, { backupDir: join(d, '.yoke', 'backup', 'x') },
    )
    expect(res[0].status).toBe('created')
    expect(readFileSync(join(d, '.yoke/context/PROJECT.md'), 'utf8')).toBe('TEMPLATE')
    rmSync(d, { recursive: true, force: true })
  })

  it('ifAbsent action leaves an existing file untouched and takes no backup', () => {
    const d = mkdtempSync(join(tmpdir(), 'yoke-apply-'))
    const dest = join(d, '.yoke/context/PROJECT.md')
    mkdirSync(join(d, '.yoke/context'), { recursive: true })
    writeFileSync(dest, 'USER CONTENT')
    const res = applyActions(
      [{ kind: 'write', target: '.yoke/context/PROJECT.md', content: 'TEMPLATE', reason: 'scaffold', ifAbsent: true }],
      d, { backupDir: join(d, '.yoke', 'backup', 'x') },
    )
    expect(res[0].status).toBe('unchanged')
    expect(res[0].backedUp).toBeUndefined()
    expect(readFileSync(dest, 'utf8')).toBe('USER CONTENT')
    rmSync(d, { recursive: true, force: true })
  })

  it('ifAbsent action preserves a user edit across a re-run (cross-run idempotency)', () => {
    const d = mkdtempSync(join(tmpdir(), 'yoke-apply-'))
    const dest = join(d, '.yoke/context/PROJECT.md')
    const action: Action = { kind: 'write', target: '.yoke/context/PROJECT.md', content: 'TEMPLATE', reason: 'scaffold', ifAbsent: true }
    const first = applyActions([action], d, { backupDir: join(d, '.yoke', 'backup', 'x') })
    expect(first[0].status).toBe('created')
    expect(readFileSync(dest, 'utf8')).toBe('TEMPLATE')
    writeFileSync(dest, 'USER EDIT')
    const second = applyActions([action], d, { backupDir: join(d, '.yoke', 'backup', 'y') })
    expect(second[0].status).toBe('unchanged')
    expect(readFileSync(dest, 'utf8')).toBe('USER EDIT')
    rmSync(d, { recursive: true, force: true })
  })
})
