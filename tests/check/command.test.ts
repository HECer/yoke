import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { checkProject, protectAcceptance } from '../../src/check/command.js'

let root: string
let state: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'yoke-check-')); state = mkdtempSync(join(tmpdir(), 'yoke-state-')); vi.stubEnv('YOKE_STATE_DIR', state); mkdirSync(join(root, '.yoke')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }); rmSync(state, { recursive: true, force: true }); vi.unstubAllEnvs() })
function criteria() {
  writeFileSync(join(root, '.yoke', 'acceptance.yaml'), 'version: 1\ncriteria:\n  - id: checkout\n    text: Guest checkout works\n    commands: [node test.mjs]\nprotected: [test.mjs]\n')
  writeFileSync(join(root, 'test.mjs'), 'process.exit(0)')
}
it('runs an acceptance command and persists content-bound evidence without retrofit', () => {
  criteria()
  const report = checkProject(root)
  expect(report.status).toBe('passed')
  expect(report.criteria[0].status).toBe('passed')
  expect(JSON.parse(readFileSync(report.evidencePath, 'utf8')).fingerprint).toMatch(/^[a-f0-9]{64}$/)
})
it('does not claim an unmapped natural-language requirement was verified', () => {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }))
  const report = checkProject(root, { requirement: 'Payments are correct', execute: () => ({ passed: true, summary: 'green' }) })
  expect(report.status).toBe('unverified')
  expect(report.criteria.some(c => c.status === 'unverified')).toBe(true)
})
it('reports command failures with executable reproduction', () => {
  criteria(); writeFileSync(join(root, 'test.mjs'), 'process.exit(1)')
  const report = checkProject(root)
  expect(report.status).toBe('failed')
  expect(report.criteria[0].commands).toEqual(['node test.mjs'])
})
it('refuses acceptance files changed after protection was established', () => {
  criteria(); protectAcceptance(root)
  writeFileSync(join(root, 'test.mjs'), '// silently weakened')
  let called = false
  const report = checkProject(root, { execute: () => { called = true; return { passed: true, summary: 'green' } } })
  expect(report.status).toBe('failed'); expect(called).toBe(false)
})
it('marks evidence invalid when verification changes source', () => {
  criteria()
  const report = checkProject(root, { execute: () => { writeFileSync(join(root, 'source.ts'), 'changed'); return { passed: true, summary: 'green' } } })
  expect(report.status).toBe('failed')
  expect(report.summary).toMatch(/changed/)
})
it('rejects protected paths outside the project', () => {
  writeFileSync(join(root, '.yoke', 'acceptance.yaml'), 'version: 1\ncriteria: []\nprotected: [../outside]\n')
  expect(() => protectAcceptance(root)).toThrow(/path|outside|escape/i)
})
it('invalidates evidence if a command changes an unpinned manifest', () => {
  criteria()
  expect(checkProject(root, { execute: () => { writeFileSync(join(root, '.yoke', 'acceptance.yaml'), 'version: 1\ncriteria: []\n'); return { passed: true, summary: 'green' } } }).status).toBe('failed')
})
