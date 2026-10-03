import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { checkProject, checkProjectAsync, loadAcceptance } from '../../src/check/command.js'
import { DELIVERY_HASH_LIMITS, startDelivery } from '../../src/check/delivery.js'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'yoke-delivery-')); mkdirSync(join(root, '.yoke')); vi.stubEnv('YOKE_STATE_DIR', join(root, '.state')) })
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); rmSync(root, { recursive: true, force: true }); vi.unstubAllEnvs() })
function fixture() {
  mkdirSync(join(root, 'dist')); writeFileSync(join(root, 'dist', 'app.zip'), 'candidate A')
  writeFileSync(join(root, '.gitignore'), 'dist/\n.state/\n')
  writeFileSync(join(root, '.yoke', 'acceptance.yaml'), stringify({ version: 1, criteria: [{ id: 'save', text: 'A saved item survives reload', commands: ['node journeys.mjs'] }],
    delivery: { version: 1, environment: { name: 'staging' }, artifacts: [{ path: 'dist/app.zip', criteria: ['save'] }], journeys: [{ id: 'save-reload', text: 'Create, save and reload', criteria: ['save'] }] },
  }))
}
it('binds source, acceptance, declared artifacts and journey results to persisted evidence', () => {
  fixture()
  const report = checkProject(root, { execute: () => ({ passed: true, summary: 'saved and reloaded' }) })
  expect(report.status).toBe('passed')
  expect(report.delivery?.acceptanceDigest).toBe(createHash('sha256').update(readFileSync(join(root, '.yoke', 'acceptance.yaml'))).digest('hex'))
  expect(report.delivery?.artifacts[0]).toMatchObject({ path: 'dist/app.zip', status: 'passed', binding: 'declared-criteria', stable: true })
  expect(report.delivery?.journeys[0]).toMatchObject({ id: 'save-reload', status: 'passed' })
  expect(report.delivery?.environment).toMatchObject({ platform: process.platform, declared: { name: 'staging' } })
  expect(JSON.parse(readFileSync(report.evidencePath, 'utf8')).delivery).toEqual(report.delivery)
})
it('fails if a declared artifact changed while tests passed, including ignored build output', async () => {
  fixture()
  const report = await checkProjectAsync(root, { execute: () => { writeFileSync(join(root, 'dist', 'app.zip'), 'candidate B'); return { passed: true, summary: 'green' } } })
  expect(report.status).toBe('failed')
  expect(report.delivery?.artifacts[0]).toMatchObject({ stable: false, status: 'failed' })
  expect(report.delivery?.journeys[0].status).toBe('unverified')
})
it('does not claim unexecuted journey criteria are proved', () => {
  fixture()
  const manifest = loadAcceptance(root)!
  manifest.criteria[0].commands = []
  writeFileSync(join(root, '.yoke', 'acceptance.yaml'), stringify(manifest))
  const report = checkProject(root)
  expect(report.status).toBe('unverified')
  expect(report.delivery?.journeys[0].status).toBe('unverified')
  expect(report.delivery?.unverifiedRequirementIds).toEqual(['save'])
})
it('rejects dangling journey references and artifacts escaping the project', () => {
  fixture()
  const manifest = loadAcceptance(root)!
  manifest.delivery!.journeys[0].criteria = ['invented']
  writeFileSync(join(root, '.yoke', 'acceptance.yaml'), stringify(manifest))
  expect(() => loadAcceptance(root)).toThrow(/unknown criterion/i)
  manifest.delivery!.journeys[0].criteria = ['save']
  manifest.delivery!.artifacts[0].path = '../outside.zip'
  writeFileSync(join(root, '.yoke', 'acceptance.yaml'), stringify(manifest))
  expect(checkProject(root, { execute: () => ({ passed: true, summary: 'ok' }) }).status).toBe('failed')
})

it('bounds artifact bytes before reading and respects a snapshot deadline', () => {
  fixture()
  const manifest = loadAcceptance(root)!
  truncateSync(join(root, 'dist', 'app.zip'), DELIVERY_HASH_LIMITS.fileBytes + 1)
  expect(startDelivery(root, manifest, null).artifacts[0].problem).toMatch(/byte file limit/u)
  expect(startDelivery(root, manifest, null, { deadline: Date.now() - 1 }).artifacts[0].problem).toMatch(/deadline/u)
})

it('rejects a linked artifact directory without reading through it', () => {
  fixture()
  symlinkSync(join(root, 'dist'), join(root, 'linked'), 'junction')
  const manifest = loadAcceptance(root)!
  manifest.delivery!.artifacts[0].path = 'linked/app.zip'
  expect(startDelivery(root, manifest, null).artifacts[0].problem).toMatch(/symbolic links/u)
})

it('checks source integrity after final artifact reads and withholds stale journey proof', () => {
  fixture()
  let armed = false
  const original = fs.readSync
  vi.spyOn(fs, 'readSync').mockImplementation((...args) => {
    const count = Reflect.apply(original, fs, args) as number
    if (armed && args[1].byteLength === 256 * 1024) { armed = false; writeFileSync(join(root, 'changed-source.txt'), 'changed during final hashing') }
    return count
  })
  syncBuiltinESMExports()
  const report = checkProject(root, { execute: () => { armed = true; return { passed: true, summary: 'green' } } })
  expect(report.status).toBe('failed')
  expect(report.criteria).toContainEqual(expect.objectContaining({ id: 'source-integrity', status: 'failed' }))
  expect(report.delivery?.artifacts[0]).toMatchObject({ stable: true, status: 'unverified' })
  expect(report.delivery?.journeys[0].status).toBe('unverified')
  expect(report.delivery?.passedRequirementIds).toEqual([])
  expect(report.delivery?.unverifiedRequirementIds).toEqual(['save'])
})

it('keeps existing version-1 acceptance manifests without delivery declarations usable', () => {
  writeFileSync(join(root, '.yoke', 'acceptance.yaml'), stringify({ version: 1, criteria: [{ id: 'legacy', text: 'Existing check', commands: ['node old-check.mjs'] }] }))
  const report = checkProject(root, { execute: () => ({ passed: true, summary: 'ok' }) })
  expect(report.status).toBe('passed')
  expect(report.delivery).toMatchObject({ artifacts: [], journeys: [], passedRequirementIds: ['legacy'] })
})
