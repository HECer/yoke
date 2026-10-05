import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acceptanceProtectionProblem, protectAcceptance } from '../../src/check/command.js'
import { createHash } from 'node:crypto'

let root: string, candidate: string, state: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'contract-root-')); candidate = mkdtempSync(join(tmpdir(), 'contract-candidate-')); state = mkdtempSync(join(tmpdir(), 'contract-state-'))
  mkdirSync(join(root, '.yoke')); mkdirSync(join(candidate, '.yoke')); vi.stubEnv('YOKE_STATE_DIR', state)
})
afterEach(() => { for (const dir of [root, candidate, state]) rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs() })
it.each(['requirements.yaml', 'plan.md'])('protects %s deletion without an acceptance manifest or pinned baseline', name => {
  writeFileSync(join(root, '.yoke', name), 'original contract')
  expect(acceptanceProtectionProblem(candidate, root) ?? '').toMatch(/planning|requirement|protected/i)
})
it.each(['requirements.yaml', 'plan.md'])('protects %s rewriting without a pinned acceptance baseline', name => {
  writeFileSync(join(root, '.yoke', name), 'original contract'); writeFileSync(join(candidate, '.yoke', name), 'changed contract')
  expect(acceptanceProtectionProblem(candidate, root) ?? '').toMatch(/planning|requirement|protected/i)
})
it.each(['requirements.yaml', 'plan.md'])('rejects candidate-only %s additions', name => {
  writeFileSync(join(candidate, '.yoke', name), 'new unauthorized contract')
  expect(acceptanceProtectionProblem(candidate, root) ?? '').toMatch(/planning|requirement|protected/i)
})
it('permits legacy projects with both contracts absent and identical contracts', () => {
  expect(acceptanceProtectionProblem(candidate, root)).toBeNull()
  for (const name of ['requirements.yaml', 'plan.md']) for (const dir of [root, candidate]) writeFileSync(join(dir, '.yoke', name), 'identical')
  expect(acceptanceProtectionProblem(candidate, root)).toBeNull()
})
it('compares the original bytes rather than lossy UTF-8 decoding', () => {
  writeFileSync(join(root, '.yoke', 'plan.md'), Buffer.from([0xff])); writeFileSync(join(candidate, '.yoke', 'plan.md'), Buffer.from([0xfe]))
  expect(acceptanceProtectionProblem(candidate, root)).not.toBeNull()
})
it.each(['requirements.yaml', 'plan.md'])('pins present %s alongside protected acceptance', name => {
  writeFileSync(join(root, '.yoke', 'acceptance.yaml'), 'version: 1\ncriteria: []\n')
  writeFileSync(join(root, '.yoke', name), 'original contract')
  const path = protectAcceptance(root)
  expect(JSON.parse(readFileSync(path, 'utf8')).hashes).toHaveProperty(`.yoke/${name}`)
  writeFileSync(join(root, '.yoke', name), 'rewritten after pinning')
  expect(acceptanceProtectionProblem(root)).not.toBeNull()
})
it('retains version-1 raw CRLF baseline protection while permitting equivalent checkouts', () => {
  for (const dir of [root, candidate]) writeFileSync(join(dir, '.yoke', 'acceptance.yaml'), 'version: 1\ncriteria: []\nprotected: [.yoke/plan.md]\n')
  writeFileSync(join(root, '.yoke', 'plan.md'), 'approved\r\ncontract\r\n')
  writeFileSync(join(candidate, '.yoke', 'plan.md'), 'approved\ncontract\n')
  const path = protectAcceptance(root), baseline = JSON.parse(readFileSync(path, 'utf8'))
  // Versions before 1.25 pinned explicitly listed planning files with raw SHA-256.
  baseline.hashes['.yoke/plan.md'] = createHash('sha256').update(readFileSync(join(root, '.yoke', 'plan.md'))).digest('hex')
  writeFileSync(path, JSON.stringify(baseline))
  expect(acceptanceProtectionProblem(root)).toBeNull()
  expect(acceptanceProtectionProblem(candidate, root)).toBeNull()
  writeFileSync(join(candidate, '.yoke', 'plan.md'), 'weakened\ncontract\n')
  expect(acceptanceProtectionProblem(candidate, root)).not.toBeNull()
  writeFileSync(join(root, '.yoke', 'plan.md'), 'weakened\r\ncontract\r\n')
  expect(acceptanceProtectionProblem(root)).not.toBeNull()
})
