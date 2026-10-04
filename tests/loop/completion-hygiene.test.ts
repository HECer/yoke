import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runLoopCommand } from '../../src/loop/run-command.js'
import { saveConfig, defaultConfig } from '../../src/retrofit/config.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
it.each([1, 2])('blocks dirty completion outputs with %s worker(s) without committing user assets', async parallel => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-completion-hygiene-')); roots.push(root)
  mkdirSync(join(root, '.yoke'))
  writeFileSync(join(root, 'final.png'), 'initial')
  writeFileSync(join(root, '.yoke', 'prd.yaml'), '- { id: S1, title: done, priority: 1, acceptance: [done], passes: true }')
  saveConfig(root, { ...defaultConfig('1.22.0'), loop: { enabled: true }, verify: { command: 'node -e "process.exit(0)"', requireCriteria: false },
    completion: { command: 'node -e "require(\'node:fs\').writeFileSync(\'final.png\', \'changed\')"' } })
  let commits = 0
  const code = await runLoopCommand(root, { parallel, maxIterations: 1, isAvailable: () => true,
    git: { isClean: () => readFileSync(join(root, 'final.png'), 'utf8') === 'initial',
      commitAll: () => { commits++ }, addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} } })
  expect(code).not.toBe(0)
  expect(commits).toBe(0)
  expect(readFileSync(join(root, 'final.png'), 'utf8')).toBe('changed')
  const status = JSON.parse(readFileSync(join(root, '.yoke', 'loop-status.json'), 'utf8'))
  expect(status.state).toBe('blocked')
  expect(status.reason).toContain('completion command left')
})
