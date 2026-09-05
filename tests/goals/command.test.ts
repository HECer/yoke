import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProjectGoal, runProjectGoal, readProjectGoal, goalHandoff, pauseProjectGoal } from '../../src/goals/command.js'
let root: string
let state: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'yoke-goal-')); state = mkdtempSync(join(tmpdir(), 'yoke-state-')); vi.stubEnv('YOKE_STATE_DIR', state); mkdirSync(join(root, '.yoke')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }); rmSync(state, { recursive: true, force: true }); vi.unstubAllEnvs() })
function manifest() { writeFileSync(join(root, '.yoke', 'acceptance.yaml'), 'version: 1\nprotected: [test.mjs]\ncriteria:\n- id: outcome\n  text: Expected outcome\n  commands: [node test.mjs]\n') }
it('does not replace an unfinished objective', () => {
  createProjectGoal(root, 'First objective')
  expect(() => createProjectGoal(root, 'Different objective')).toThrow(/unfinished|active/i)
})
it('rejects a linked Yoke state parent without writing a pause marker elsewhere', () => {
  createProjectGoal(root, 'First')
  rmSync(join(root, '.yoke'), { recursive: true })
  symlinkSync(state, join(root, '.yoke'), 'junction')
  expect(() => pauseProjectGoal(root)).toThrow(/linked/i)
  expect(existsSync(join(state, 'goal.pause'))).toBe(false)
})
it('clears an old pause when a new goal is explicitly created', () => {
  const goal = createProjectGoal(root, 'First')
  pauseProjectGoal(root)
  writeFileSync(join(root, '.yoke', 'goal.json'), JSON.stringify({ ...goal, status: 'complete' }))
  createProjectGoal(root, 'Second')
  expect(existsSync(join(root, '.yoke', 'goal.pause'))).toBe(false)
})
it('never runs an agent for an objective without executable acceptance', async () => {
  createProjectGoal(root, 'Ship checkout')
  let ran = false
  const result = await runProjectGoal(root, { execute: async () => { ran = true; return { success: true, summary: 'done' } } })
  expect(ran).toBe(false); expect(result.status).toBe('blocked')
})
it('only completes after independent acceptance passes', async () => {
  manifest(); writeFileSync(join(root, 'test.mjs'), 'import {existsSync} from "node:fs"; process.exit(existsSync("implemented.txt") ? 0 : 1)')
  createProjectGoal(root, 'Expected outcome')
  const result = await runProjectGoal(root, { execute: async () => { writeFileSync(join(root, 'implemented.txt'), 'done'); return { success: true, summary: 'implemented' } } })
  expect(result.status).toBe('complete'); expect(result.attempts).toHaveLength(1)
  expect(readProjectGoal(root)?.status).toBe('complete')
})
it('stops bounded retries and passes failure context to a different provider', async () => {
  manifest(); writeFileSync(join(root, 'test.mjs'), 'process.exit(1)')
  createProjectGoal(root, 'Expected outcome', { maxAttempts: 2 })
  const prompts: string[] = []
  const result = await runProjectGoal(root, { provider: 'gemini', execute: async input => { prompts.push(input.prompt); return { success: false, summary: 'still blocked' } } })
  expect(result.status).toBe('blocked'); expect(result.attempts).toHaveLength(2)
  expect(prompts[1]).toContain('still blocked')
  expect(goalHandoff(root)).toContain('Expected outcome')
})
it('blocks attempts to weaken the acceptance manifest during implementation', async () => {
  manifest(); writeFileSync(join(root, 'test.mjs'), 'process.exit(1)')
  createProjectGoal(root, 'Expected outcome')
  const result = await runProjectGoal(root, { execute: async () => {
    writeFileSync(join(root, '.yoke', 'acceptance.yaml'), 'version: 1\ncriteria:\n- id: fake\n  text: Nothing\n  commands: [node -e "process.exit(0)"]\n')
    return { success: true, summary: 'done' }
  } })
  expect(result.status).toBe('blocked')
  expect(result.reason).toMatch(/acceptance/i)
})
it('does not accept a worker rewriting its protected test', async () => {
  manifest(); writeFileSync(join(root, 'test.mjs'), 'process.exit(1)'); createProjectGoal(root, 'Expected outcome')
  const result = await runProjectGoal(root, { execute: async () => { writeFileSync(join(root, 'test.mjs'), 'process.exit(0)'); return { success: true, summary: 'fake' } } })
  expect(result.status).toBe('blocked')
})
it('revalidates a previously completed goal', async () => {
  manifest(); writeFileSync(join(root, 'test.mjs'), 'import {existsSync} from "node:fs"; process.exit(existsSync("implemented.txt") ? 0 : 1)')
  writeFileSync(join(root, 'implemented.txt'), 'done'); createProjectGoal(root, 'Expected outcome', { maxAttempts: 1 })
  expect((await runProjectGoal(root)).status).toBe('complete')
  rmSync(join(root, 'implemented.txt'))
  expect((await runProjectGoal(root, { execute: async () => ({ success: false, summary: 'regressed' }) })).status).toBe('blocked')
})
it('charges interrupted attempts before allowing budgeted continuation', async () => {
  manifest(); writeFileSync(join(root, 'test.mjs'), 'process.exit(1)'); createProjectGoal(root, 'Expected outcome', { tokenBudget: 100 })
  const path = join(root, '.yoke', 'goal.json')
  const goal = JSON.parse(readFileSync(path, 'utf8'))
  writeFileSync(path, JSON.stringify({ ...goal, status: 'running', pendingAttempt: { provider: 'claude', startedAt: new Date().toISOString() } }))
  let ran = false
  const result = await runProjectGoal(root, { execute: async () => { ran = true; return { success: true, summary: 'should not run' } } })
  expect(ran).toBe(false); expect(result.attempts).toHaveLength(1); expect(result.reason).toMatch(/unknown/i)
})
