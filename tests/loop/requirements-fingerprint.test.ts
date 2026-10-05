import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { workspaceFingerprint } from '../../src/workspace/fingerprint.js'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
it('binds ignored requirement and approved-plan bytes while excluding status updates', () => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-policy-fingerprint-')); roots.push(root); mkdirSync(join(root, '.yoke'))
  const before = workspaceFingerprint(root)
  writeFileSync(join(root, '.yoke/requirements.yaml'), 'requirement: keep critical faults')
  const withRequirements = workspaceFingerprint(root)
  expect(withRequirements).not.toBe(before)
  writeFileSync(join(root, '.yoke/loop-status.json'), '{}')
  expect(workspaceFingerprint(root)).toBe(withRequirements)
  writeFileSync(join(root, '.yoke/plan.md'), 'approved plan')
  expect(workspaceFingerprint(root)).not.toBe(withRequirements)
})
