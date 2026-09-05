import { beforeEach, afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendEvent, readEvents, EVENT_MAX_BYTES, EVENT_CAP } from '../../src/observability/events.js'
let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'yoke-event-store-')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))
it('preserves previous event files while bounding reads and large payloads', () => {
  const event = { runId: 'run', timestamp: new Date().toISOString(), type: 'status' as const }
  appendEvent(root, event)
  const dir = join(root, '.yoke/events')
  const first = readdirSync(dir)[0]
  const content = readFileSync(join(dir, first), 'utf8')
  appendEvent(root, { ...event, data: { content: 'x'.repeat(EVENT_MAX_BYTES) } })
  expect(readFileSync(join(dir, first), 'utf8')).toBe(content)
  expect(readEvents(root, 1)).toHaveLength(1)
  expect(readEvents(root, 1)[0].data).toEqual({ truncated: true })
  writeFileSync(join(dir, first), 'malformed')
  expect(readEvents(root)).toHaveLength(1)
  expect(readEvents(root, Infinity)).toEqual([])
})
it('retains a bounded number of immutable events', () => {
  const event = { runId: 'run', timestamp: new Date().toISOString(), type: 'status' as const }
  appendEvent(root, event)
  const dir = join(root, '.yoke/events')
  for (let index = 0; index < EVENT_CAP; index++) writeFileSync(join(dir, `0000000000000-00000000-0000-0000-0000-${String(index).padStart(12, '0')}.json`), JSON.stringify({ ...event, schemaVersion: 1, id: String(index) }))
  appendEvent(root, event)
  expect(readdirSync(dir)).toHaveLength(EVENT_CAP)
  expect(readEvents(root, EVENT_CAP + 100)).toHaveLength(EVENT_CAP)
})
