import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { saveConfig } from '../../src/retrofit/config.js'
import { savePrd } from '../../src/loop/prd.js'
import { runLoopCommand } from '../../src/loop/run-command.js'
const explore = vi.hoisted(() => vi.fn(() => ({ kind: 'paused' })))
vi.mock('../../src/prd/explore.js', () => ({ runPrdExplore: explore }))
const roots: string[] = []
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); explore.mockClear(); vi.unstubAllEnvs() })
it.each([1, 2])('routes ordinary red completion into focused repair exploration with parallel=%s', async parallel => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-completion-recovery-')); roots.push(root)
  mkdirSync(join(root, '.yoke'))
  saveConfig(root, { canonVersion: 'test', agents: ['codex'], loop: { enabled: true }, completion: { command: 'node completion.cjs', retries: 0 } })
  savePrd(join(root, '.yoke/prd.yaml'), [{ id: 'A', title: 'done story', priority: 1, acceptance: ['existing proof'], passes: true }])
  writeFileSync(join(root, 'completion.cjs'), 'process.stderr.write("tracking journey failed");process.exit(1)')
  vi.stubEnv('XDG_STATE_HOME', root); vi.stubEnv('LOCALAPPDATA', ''); vi.stubEnv('YOKE_PHASE', 'original-phase')
  const runner = vi.fn(() => ({ success: true, summary: 'must not start' }))
  const code = await runLoopCommand(root, { explore: true, parallel, agent: 'codex', routing: false, quiet: true, runner,
    verify: () => ({ passed: true, summary: 'green' }), isAvailable: () => false,
    intake: () => ({ ok: true, added: 0, summary: 'none' }),
    git: { isClean: () => true, addWorktree: () => {}, removeWorktree: () => {}, commitAll: () => {}, integrate: () => {} },
  })
  expect(code).toBe(3)
  expect(explore).toHaveBeenCalledOnce()
  expect(explore).toHaveBeenCalledWith(root, expect.objectContaining({ focus: expect.stringContaining('tracking journey failed') }))
  expect(runner).not.toHaveBeenCalled()
  expect(process.env.YOKE_PHASE).toBe('original-phase')
})
