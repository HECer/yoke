import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { runStoryWorker } from '../../src/loop/worker.js'
import { runLoop } from '../../src/loop/loop.js'
import { savePrd, type Story } from '../../src/loop/prd.js'
import type { GitOps } from '../../src/loop/gates.js'

const roots: string[] = []
const story: Story = { id: 'S1', title: 'Deliver', priority: 1, passes: false, acceptance: ['flow works'] }
const git: GitOps = { isClean: () => true, addWorktree: () => {}, removeWorktree: () => {}, commitAll: () => {}, integrate: () => {} }
function fixture() { const root = mkdtempSync(join(tmpdir(), 'yoke-interruption-')); roots.push(root); mkdirSync(join(root, '.yoke')); savePrd(join(root, '.yoke/prd.yaml'), [story]); return root }
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))

it.each(['cancel', 'decision', 'ambiguity', 'pause'] as const)('closes an interrupted %s worker attempt without model-quality blame', async reason => {
  const root = fixture(); const controller = new AbortController(); const outcome = vi.fn(); let pause = false
  const result = await runStoryWorker({ story, worktree: root, baseCommit: 'base', provider: { provider: 'codex', role: 'implementation' },
    runner: () => {
      if (reason === 'cancel') controller.abort('cancelled by operator')
      if (reason === 'ambiguity') writeFileSync(join(root, '.yoke/ambiguity.md'), 'Which behavior?')
      if (reason === 'pause') pause = true
      return { success: true, summary: 'work in progress', routing: { recordOutcome: outcome } }
    },
    beforeGates: () => reason === 'decision' ? 'Need a product decision' : null,
    verify: () => ({ passed: true, summary: 'green' }), cancellation: { signal: controller.signal }, pause: () => pause,
  })
  expect(result.kind).toBe(reason === 'cancel' ? 'cancelled' : 'paused')
  expect(outcome.mock.calls).toEqual([[false, 'infrastructure']])
})

it('closes a serial ambiguity abort as interrupted while retaining work', () => {
  const root = fixture(); const outcome = vi.fn()
  const result = runLoop({ targetDir: root, prdPath: join(root, '.yoke/prd.yaml'), maxIterations: 1, git,
    runner: () => { writeFileSync(join(root, '.yoke/ambiguity.md'), 'Which behavior?'); return { success: true, summary: 'question', routing: { recordOutcome: outcome } } },
    verify: () => ({ passed: true, summary: 'green' }),
  })
  expect(result.status).toBe('blocked')
  expect(outcome.mock.calls).toEqual([[false, 'infrastructure']])
})

it('does not record delivery success when the serial commit fails', () => {
  const root = fixture(); const outcome = vi.fn()
  const result = runLoop({ targetDir: root, prdPath: join(root, '.yoke/prd.yaml'), maxIterations: 1,
    git: { ...git, commitAll: () => { throw new Error('commit storage unavailable') } },
    runner: () => ({ success: true, summary: 'implemented', routing: { recordOutcome: outcome } }),
    verify: () => ({ passed: true, summary: 'green' }),
  })
  expect(result.status).toBe('blocked')
  expect(outcome.mock.calls).toEqual([[false, 'infrastructure']])
})
