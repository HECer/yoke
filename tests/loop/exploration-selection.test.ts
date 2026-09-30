import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { saveConfig } from '../../src/retrofit/config.js'
import { runLoopCommand, resumeLoopCommand } from '../../src/loop/run-command.js'
import { readRunState } from '../../src/loop/run-state.js'
import { realGitOps } from '../../src/loop/git.js'
const { explore } = vi.hoisted(() => ({ explore: vi.fn(() => ({ kind: 'paused' as const })) }))
vi.mock('../../src/prd/explore.js', () => ({ runPrdExplore: explore }))
vi.mock('../../src/loop/runner.js', async original => ({ ...await original<typeof import('../../src/loop/runner.js')>(), isAgentAvailable: () => true }))
const roots: string[] = []
afterEach(() => { vi.restoreAllMocks(); explore.mockClear(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })) })

it('preserves the independent configured planner and its model across supervisor resume', async () => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-explore-selection-')); roots.push(root)
  mkdirSync(join(root, '.yoke'))
  writeFileSync(join(root, '.yoke', 'prd.yaml'), '- { id: done, title: Done, priority: 1, acceptance: [complete], passes: true }')
  saveConfig(root, { canonVersion: 'test', agents: ['codex', 'gemini'], runner: { agent: 'codex', model: 'implementation-model', bare: true }, planning: { agent: 'gemini', model: 'planning-model' }, loop: { enabled: true }, commit: { authorName: 'Yoke Test', authorEmail: 'yoke-test@example.invalid' }, verify: { command: 'node -e "process.exit(0)"' } })
  vi.spyOn(realGitOps, 'isClean').mockReturnValue(true)
  expect(await runLoopCommand(root, { explore: true, quiet: true })).toBe(3)
  const original = readRunState(root)
  expect(await resumeLoopCommand(root)).toBe(3)
  expect(explore).toHaveBeenCalledTimes(2)
  expect(explore.mock.calls.map(call => (call as unknown as [string, { runner: string }])[1].runner)).toEqual(['gemini', 'gemini'])
  expect(explore.mock.calls.map(call => (call as unknown as [string, { selection: { model?: string; bare?: boolean } }])[1].selection)).toEqual([
    expect.objectContaining({ model: 'planning-model' }), expect.objectContaining({ model: 'planning-model' }),
  ])
  expect((explore.mock.calls[1] as unknown as [string, { selection: { bare?: boolean } }])[1].selection.bare).toBeUndefined()
  expect(readRunState(root)?.runId).toBe(original?.runId)
})
