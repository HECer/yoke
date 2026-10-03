import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { saveConfig } from '../../src/retrofit/config.js'
import { savePrd, loadPrd } from '../../src/loop/prd.js'
import { runLoopCommand } from '../../src/loop/run-command.js'
const roots: string[] = []
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); vi.unstubAllEnvs() })
it('diagnoses an unchanged rejected integration after one inexpensive recheck', async () => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-integration-progress-')); roots.push(root)
  mkdirSync(join(root, '.yoke'))
  saveConfig(root, { canonVersion: 'test', agents: ['codex'], loop: { enabled: true } })
  savePrd(join(root, '.yoke/prd.yaml'), [{ id: 'A', title: 'flow', priority: 1, acceptance: ['proof'], passes: false }])
  writeFileSync(join(root, '.gitignore'), '.yoke/*\n!.yoke/config.yaml\n!.yoke/prd.yaml\n')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid'); git('add', '.'); git('commit', '-m', 'fixture')
  const pool = mkdtempSync(join(tmpdir(), 'yoke-integration-pool-')); roots.push(pool); vi.stubEnv('XDG_STATE_HOME', pool); vi.stubEnv('LOCALAPPDATA', '')
  let runnerCalls = 0, gateCalls = 0
  const feedback: (string | undefined)[] = []
  const runner = (context: { targetDir: string; feedback?: string }) => {
    runnerCalls++; feedback.push(context.feedback)
    writeFileSync(join(context.targetDir, 'app.ts'), runnerCalls === 1 ? 'original candidate' : 'diagnosed repair')
    return { success: true, summary: 'implementation' }
  }
  const common = { parallel: 2, maxIterations: 1, agent: 'codex' as const, routing: false, quiet: true, runner, isAvailable: () => false }
  expect(await runLoopCommand(root, { ...common, verify: () => ({ passed: ++gateCalls === 1, summary: 'integration flow failed' }) })).toBe(1)
  expect(runnerCalls).toBe(1)
  expect(await runLoopCommand(root, { ...common, verify: () => ({ passed: false, summary: 'integration flow failed' }) })).toBe(1)
  expect(runnerCalls).toBe(1)
  const name = readdirSync(join(root, '.yoke/integration-recovery'))[0]!
  expect(JSON.parse(readFileSync(join(root, '.yoke/integration-recovery', name), 'utf8'))).toMatchObject({ phase: 'implementation' })
  expect(await runLoopCommand(root, { ...common, verify: () => ({ passed: true, summary: 'flow fixed' }) })).toBe(0)
  expect(runnerCalls).toBe(2)
  expect(feedback[1]).toContain('diagnose')
  expect(readFileSync(join(root, 'app.ts'), 'utf8')).toBe('diagnosed repair')
  expect(loadPrd(join(root, '.yoke/prd.yaml'))[0]?.passes).toBe(true)
})
