import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseHistoryCursor, projectAnalytics, projectHistory, workspaceAnalytics } from '../../src/dashboard/analytics.js'
import { latestCheckFile } from '../../src/dashboard/latest-check.js'
import { DASHBOARD_LIMITS } from '../../src/dashboard/contracts.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function project() { const root = mkdtempSync(join(tmpdir(), 'yoke-history-bounds-')); roots.push(root); return root }
const period = { from: Date.parse('2026-11-01T00:00:00Z'), to: Date.parse('2026-11-02T00:00:00Z'), bucket: 'day' as const }
function history(root: string, count: number, separateRuns = false, prefix = '') {
  const directory = join(root, '.yoke', 'history', '2026-11-01')
  mkdirSync(directory, { recursive: true })
  const events = Array.from({ length: count }, (_, index) => ({ schemaVersion: 1, id: prefix + String(index).padStart(36, '0'), runId: separateRuns ? `run-${index}` : prefix + 'one-run', timestamp: new Date(period.from + Math.floor(index / 2)).toISOString(), type: 'accepted', storyId: separateRuns ? `task-${index}` : 'task' }))
  writeFileSync(join(directory, 'a'.repeat(32) + '.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n')
  return events
}

it('finds the newest failed check beyond 2,000 UUID filenames', () => {
  const root = project(), directory = join(root, '.yoke', 'checks')
  mkdirSync(directory, { recursive: true })
  const old = new Date('2026-10-01'), current = new Date('2026-11-01')
  for (let index = 0; index < 2001; index++) {
    const path = join(directory, index.toString(16).padStart(36, '0') + '.json')
    writeFileSync(path, JSON.stringify({ status: 'passed' })); utimesSync(path, old, old)
  }
  const newest = join(directory, readdirSync(directory)[0])
  writeFileSync(newest, JSON.stringify({ status: 'failed' })); utimesSync(newest, current, current)
  const selected = latestCheckFile(root)
  expect(selected).toBeDefined()
  expect(JSON.parse(readFileSync(join(root, selected!), 'utf8')).status).toBe('failed')
})

it('reports unavailable recency when newest reports have indistinguishable timestamps', () => {
  const root = project(), directory = join(root, '.yoke', 'checks')
  mkdirSync(directory, { recursive: true })
  for (const [id, status] of [['a', 'failed'], ['z', 'passed']] as const) {
    const path = join(directory, (id === 'z' ? 'f' : id).repeat(36) + '.json')
    writeFileSync(path, JSON.stringify({ status })); utimesSync(path, new Date('2026-11-01'), new Date('2026-11-01'))
  }
  expect(() => latestCheckFile(root)).toThrow('indistinguishable timestamps')
})

it('returns compact run summaries without repeating raw events in analytics', () => {
  const root = project(); history(root, 2000)
  const result = projectAnalytics(root, period)
  expect(result.runs[0].eventCount).toBe(2000)
  expect(result.runs[0]).not.toHaveProperty('events')
  expect(result.runs[0]).not.toHaveProperty('timestamps')
  expect(result.total.activity).toBe(2000)
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(200_000)
})

it('bounds detail tables while preserving totals and pages tied event timestamps without duplicates', () => {
  const root = project(), original = history(root, 150, true)
  const analytics = projectAnalytics(root, period)
  expect(analytics.total.accepted).toBe(150)
  expect(analytics.runs).toHaveLength(DASHBOARD_LIMITS.analyticsRows)
  expect(analytics.tasks).toHaveLength(DASHBOARD_LIMITS.analyticsRows)
  expect(analytics.rankings.runs.name).toHaveLength(DASHBOARD_LIMITS.analyticsRows)
  expect(analytics.detailsLimited).toBe(true)
  const pages = [], first = projectHistory(root, period, 99)
  pages.push(...first.events)
  const next = projectHistory(root, period, 99, parseHistoryCursor(first.nextCursor, period))
  pages.push(...next.events)
  expect(next.nextCursor).toBeNull()
  expect(pages).toHaveLength(150)
  expect(new Set(pages.map(event => event.id))).toEqual(new Set(original.map(event => event.id)))
  expect(() => parseHistoryCursor(first.nextCursor, { ...period, from: period.from + 1 })).toThrow('same from and to')
  expect(() => parseHistoryCursor('not-a-cursor', period)).toThrow('Invalid history cursor')
})

it('applies one measurement quota across workspace projects and reports incomplete coverage', () => {
  const first = project(), second = project(), third = project()
  history(first, 26000, false, 'first-'); history(second, 26000, false, 'second-'); history(third, 1, false, 'third-')
  const result = workspaceAnalytics([{ id: 'first', root: first, name: 'First' }, { id: 'second', root: second, name: 'Second' }, { id: 'third', root: third, name: 'Third' }], period)
  expect(result.total.activity).toBe(DASHBOARD_LIMITS.measurementEvents)
  expect(result.errors.join(' ')).toContain('Workspace history query limit reached')
  expect(result.projects.find(project => project.id === 'third')?.analytics).toBeNull()
  expect(result.rankings.projects.name[0]).not.toHaveProperty('analytics')
}, 15_000)
