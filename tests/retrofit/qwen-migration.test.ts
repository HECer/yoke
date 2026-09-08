import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { planQwen } from '../../src/retrofit/planners/qwen.js'
import { applyActions } from '../../src/retrofit/apply.js'
const dir = mkdtempSync(join(tmpdir(), 'yoke-qwen-migrate-'))
afterEach(() => rmSync(dir, { recursive: true, force: true }))
it('migrates only the obsolete Yoke hook while backing up the original settings', () => {
  mkdirSync(join(dir, '.qwen'))
  const keep = { name: 'custom', type: 'command', command: 'echo user' }
  const original = JSON.stringify({ hooks: { BeforeTool: [{ matcher: '^run_shell_command$', hooks: [keep, { name: 'yoke-rtk', type: 'command', command: 'node .qwen/hooks/qwen-rtk-hook.mjs' }] }] }, model: { name: 'custom-model' } })
  writeFileSync(join(dir, '.qwen/settings.json'), original)
  const actions = planQwen(resolve('canon'), dir)
  const backupDir = join(dir, 'backup')
  applyActions(actions, dir, { backupDir })
  const settings = JSON.parse(readFileSync(join(dir, '.qwen/settings.json'), 'utf8'))
  expect(settings.hooks.BeforeTool).toEqual([{ matcher: '^run_shell_command$', hooks: [keep] }])
  expect(settings.hooks.PreToolUse).toHaveLength(1)
  expect(settings.model.name).toBe('custom-model')
  expect(readFileSync(join(backupDir, '.qwen/settings.json'), 'utf8')).toBe(original)
  expect(applyActions(actions, dir, { backupDir }).filter(a => a.status !== 'unchanged').map(a => a.target)).toEqual([])
})
