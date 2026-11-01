import { afterEach, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertPreviousProvidersStopped, createSupervision, readSupervision } from '../../src/agents/supervision.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function project() { const root = mkdtempSync(join(tmpdir(), 'yoke-supervision-history-')); roots.push(root); return root }

it('selects the latest supervision by timestamp beyond the old 200-file UUID window', () => {
  const root = project(), directory = join(root, '.yoke', 'supervision')
  mkdirSync(directory, { recursive: true })
  for (let index = 0; index < 221; index++) {
    const id = String(index).padStart(36, '0')
    writeFileSync(join(directory, id + '.json'), JSON.stringify({ id, state: 'stopped', startedAt: '2026-01-01', heartbeatAt: '2026-01-01' }))
  }
  const earliestFilename = readdirSync(directory)[0]
  writeFileSync(join(directory, earliestFilename), JSON.stringify({ id: 'newest', state: 'stopped', startedAt: '2026-11-01', heartbeatAt: '2026-11-01', reason: 'provider-authentication-failed' }))
  expect(readSupervision(root, '2026-11-01')).toMatchObject([{ id: 'newest', reason: 'provider-authentication-failed' }])
  expect(readSupervision(root, '')).toHaveLength(20)
})

it('archives confirmed completions while retaining active and unconfirmed admission records', () => {
  const root = project(), directory = join(root, '.yoke', 'supervision')
  const completed = createSupervision(root, () => {})
  completed.stop('provider-exited')
  const archived = join(directory, 'completed', completed.state.id + '.json')
  expect(existsSync(join(directory, completed.state.id + '.json'))).toBe(false)
  expect(JSON.parse(readFileSync(archived, 'utf8')).state).toBe('stopped')
  expect(readSupervision(root, '')[0].id).toBe(completed.state.id)
  // Admission does not reopen historical evidence; corruption remains visible to
  // strict history reads but cannot create a new live provider ownership claim.
  writeFileSync(archived, 'corrupt archived evidence')
  expect(() => assertPreviousProvidersStopped(root)).not.toThrow()
  expect(() => readSupervision(root, '', true)).toThrow()
  const uncertain = createSupervision(root, () => {})
  uncertain.stop('group still present', false)
  expect(existsSync(join(directory, uncertain.state.id + '.json'))).toBe(true)
  expect(() => assertPreviousProvidersStopped(root)).toThrow('unconfirmed')
})

it('continues checking legacy unconfirmed records after new records have been archived', () => {
  const root = project(), directory = join(root, '.yoke', 'supervision')
  createSupervision(root, () => {}).stop()
  writeFileSync(join(directory, 'legacy.json'), JSON.stringify({ id: 'legacy', state: 'termination-unconfirmed', childPid: process.pid, startedAt: '2026-01-01', heartbeatAt: '2026-01-01' }))
  expect(() => assertPreviousProvidersStopped(root)).toThrow('unconfirmed')
})
