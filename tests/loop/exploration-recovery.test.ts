import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveConfig } from '../../src/retrofit/config.js'
import { storyPathSegment } from '../../src/loop/prd.js'
import { runLoopCommand } from '../../src/loop/run-command.js'
import { noopReporter } from '../../src/loop/reporter.js'
const parallel = vi.hoisted(() => vi.fn(async (_input: unknown) => 1))
vi.mock('../../src/loop/parallel-command.js', () => ({ runParallelLoopCommand: parallel }))
const roots: string[] = []
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); vi.clearAllMocks() })
it('keeps retained parallel recovery in the dispatcher when an exploration backlog shrinks to one story', async () => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-explore-recover-')); roots.push(root)
  mkdirSync(join(root, '.yoke', 'integration-recovery'), { recursive: true })
  writeFileSync(join(root, '.yoke', 'prd.yaml'), '- { id: A, title: Retained work, priority: 1, acceptance: [proof], passes: false }')
  writeFileSync(join(root, '.yoke', 'integration-recovery', `${storyPathSegment('A')}.json`), '{}')
  saveConfig(root, { canonVersion: '0.1.0', agents: ['codex'], loop: { enabled: true, isolate: false, parallel: 1 } })
  const runner = vi.fn(() => ({ success: true, summary: 'new implementation must not start' }))
  await runLoopCommand(root, { explore: true, explorationSupervisor: true, parallel: 1, runner, verify: () => ({ passed: true, summary: 'ok' }), reporter: noopReporter, git: { isClean: () => true, commitAll: () => {}, addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} } })
  expect(parallel).toHaveBeenCalledOnce()
  expect(parallel.mock.calls[0]?.[0]).toMatchObject({ maxConcurrency: 1 })
  expect(runner).not.toHaveBeenCalled()
})
