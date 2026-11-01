import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pendingChanges, queueChange, runChangeApply } from '../../src/change/inbox.js'
import { savePrd } from '../../src/loop/prd.js'
import { planningChange, planningStateDigest, readPlanningState } from '../../src/prd/transaction.js'

let directory: string, root: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'yoke-inbox-boundary-'))
  root = join(directory, 'project'); mkdirSync(join(root, '.yoke'), { recursive: true })
  vi.stubEnv('LOCALAPPDATA', join(directory, 'host-state'))
})
afterEach(() => { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }) })

it('rejects a symlinked pending ancestor before writing outside the project', () => {
  const outside = join(directory, 'outside'); mkdirSync(outside); mkdirSync(join(root, '.yoke/changes'))
  symlinkSync(outside, join(root, '.yoke/changes/pending'), process.platform === 'win32' ? 'junction' : 'dir')
  expect(() => queueChange(root, 'Authorized request', { id: 'escape' })).toThrow(/Linked/)
  expect(existsSync(join(outside, 'escape.json'))).toBe(false)
})

it('binds queued request text to immutable host authorization', () => {
  const request = queueChange(root, 'Approved feature', { id: 'request' })
  writeFileSync(join(root, '.yoke/changes/pending/request.json'), JSON.stringify({ ...request, request: 'Unapproved replacement objective' }))
  expect(() => pendingChanges(root)).toThrow(/host authorization/)
  const provider = vi.fn()
  expect(runChangeApply(root, { runner: 'codex', run: provider })).toMatchObject({ ok: false, summary: expect.stringContaining('host authorization') })
  expect(provider).not.toHaveBeenCalled()
})

it('requires each filename to match the parsed id and bounds inbox count and file bytes before parsing', () => {
  queueChange(root, 'Approved feature', { id: 'request' })
  const file = join(root, '.yoke/changes/pending/request.json'), moved = join(root, '.yoke/changes/pending/different.json')
  renameSync(file, moved)
  expect(() => pendingChanges(root)).toThrow(/filename/)
  renameSync(moved, file); writeFileSync(file, 'x'.repeat(100_001))
  expect(() => pendingChanges(root)).toThrow(/limit/)
  rmSync(file)
  for (let index = 0; index <= 100; index++) writeFileSync(join(root, `.yoke/changes/pending/request-${index}.json`), '{}')
  expect(() => pendingChanges(root)).toThrow(/100 pending/)
})

it('rejects a forged workspace approval receipt without committing or archiving unreviewed work', () => {
  const request = queueChange(root, 'Approved feature', { id: 'request' })
  savePrd(join(root, '.yoke/prd.yaml'), [{ id: 'S1', title: 'Unreviewed work', priority: 1, passes: false, acceptance: ['works'], sourceChange: request.id }])
  const state = readPlanningState(root)
  const hash = createHash('sha256').update(JSON.stringify(request.id)).digest('hex')
  writeFileSync(join(root, `.yoke/changes/planning-${hash}.json`), JSON.stringify({ version: 1, change: planningChange(request), stateHash: planningStateDigest(state) }))
  const commit = vi.fn(), archive = vi.fn()
  const result = runChangeApply(root, { runner: 'codex', commit, archive })
  expect(result).toMatchObject({ ok: false, summary: expect.stringContaining('host approval receipt') })
  expect(commit).not.toHaveBeenCalled(); expect(archive).not.toHaveBeenCalled()
  expect(readFileSync(join(root, '.yoke/prd.yaml'), 'utf8')).toBe(state.prd)
  expect(pendingChanges(root)).toEqual([request])
})
