import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeReporter, readStatus } from '../../src/loop/reporter.js'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
it('retains exact fresh totals only while every aggregated call measures that subset', () => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-fresh-')); roots.push(root)
  const reporter = makeReporter(root, { log: () => {} })
  reporter.addTokens({ inputTokens: 100, cachedInputTokens: 70, freshInputTokens: 30, outputTokens: 20, reasoningOutputTokens: 5 })
  reporter.addTokens({ inputTokens: 50, cachedInputTokens: 20, freshInputTokens: 30, outputTokens: 10 })
  // Token events persist immediately; status is persisted by an ordinary loop event.
  reporter.storyStart({ id: 'S1', title: 'test' }, 1, { passed: 0, total: 1 })
  expect(readStatus(root)?.tokens).toMatchObject({ inputTokens: 150, outputTokens: 30, freshInputTokens: 60, cachedInputTokens: 90 })
  reporter.addTokens({ inputTokens: 25, outputTokens: 5 })
  reporter.storyStart({ id: 'S1', title: 'test' }, 2, { passed: 0, total: 1 })
  expect(readStatus(root)?.tokens?.freshInputTokens).toBeUndefined()
  reporter.addTokens({ inputTokens: 10, freshInputTokens: 10, outputTokens: 1 })
  reporter.storyStart({ id: 'S1', title: 'test' }, 3, { passed: 0, total: 1 })
  expect(readStatus(root)?.tokens?.freshInputTokens).toBeUndefined()
})
