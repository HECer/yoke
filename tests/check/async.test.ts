import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkProjectAsync, protectAcceptance } from '../../src/check/command.js'
import { sharedPoolStatus, globalCheckLimit } from '../../src/loop/resource-pool.js'
const roots: string[] = []
function fixture() { const root = mkdtempSync(join(tmpdir(), 'yoke-async-check-')); roots.push(root); mkdirSync(join(root, '.yoke')); vi.stubEnv('LOCALAPPDATA', root); vi.stubEnv('YOKE_STATE_DIR', join(root, 'state')); writeFileSync(join(root, '.yoke', 'acceptance.yaml'), 'version: 1\nprotected: [test.mjs]\ncriteria:\n- id: behavior\n  text: Works\n  commands: [node test.mjs]\n'); writeFileSync(join(root, 'test.mjs'), 'process.exit(0)'); return root }
afterEach(() => { roots.forEach(root => rmSync(root, { recursive: true, force: true })); roots.length = 0; vi.unstubAllEnvs() })
it('runs async proof and preserves protected acceptance', async () => { const root = fixture(); protectAcceptance(root); expect((await checkProjectAsync(root)).status).toBe('passed'); writeFileSync(join(root, 'test.mjs'), 'changed'); let called = false; expect((await checkProjectAsync(root, { execute: async () => { called = true; return { passed: true, summary: 'green' } } })).status).toBe('failed'); expect(called).toBe(false) })
it('terminates stalled command at deadline and returns failed evidence', async () => { const root = fixture(); writeFileSync(join(root, 'test.mjs'), 'setTimeout(()=>{}, 60000)'); const start = Date.now(); const report = await checkProjectAsync(root, { deadline: Date.now() + 500 }); expect(report.status).toBe('failed'); expect(report.criteria.map(c => c.summary).join()).toMatch(/deadline|cancel|timeout/i); expect(Date.now() - start).toBeLessThan(6000) })
it('keeps source integrity checks across awaited commands', async () => { const root = fixture(); expect((await checkProjectAsync(root, { execute: async () => { writeFileSync(join(root, 'source.ts'), 'changed'); return { passed: true, summary: 'green' } } })).status).toBe('failed') })
it('queues whole gates and cancels waiting checks without starting their commands', async () => {
  const root = fixture(); let release: () => void = () => {}; let admitted: () => void = () => {}
  const entered = new Promise<void>(resolve => { admitted = resolve }); const hold = new Promise<void>(resolve => { release = resolve })
  const first = checkProjectAsync(root, { execute: async () => { admitted(); await hold; return { passed: true, summary: 'green' } } }); await entered
  let called = false; const controller = new AbortController()
  const second = checkProjectAsync(root, { signal: controller.signal, execute: async () => { called = true; return { passed: true, summary: 'green' } } })
  await new Promise(resolve => setTimeout(resolve, 30)); expect(sharedPoolStatus('check').activeUnits).toBe(1); controller.abort()
  expect((await second).status).toBe('failed'); expect(called).toBe(false); release(); await first
  expect(sharedPoolStatus('check').activeUnits).toBe(0); expect(sharedPoolStatus('check').waitingWorkers).toBe(0)
})
it('validates check limits without changing model worker limits', () => { expect(globalCheckLimit({})).toBe(1); expect(globalCheckLimit({ YOKE_MAX_PARALLEL_CHECKS: '2' })).toBe(2); expect(() => globalCheckLimit({ YOKE_MAX_PARALLEL_CHECKS: '0' })).toThrow() })
it('retains the check permit when process cleanup is unconfirmed', async () => {
  const root = fixture(); const report = await checkProjectAsync(root, { execute: async () => ({ passed: false, summary: 'cleanup unconfirmed', cleanupUnconfirmed: true }) })
  expect(report.status).toBe('failed'); expect(report.cleanupUnconfirmed).toBe(true); expect(sharedPoolStatus('check').activeUnits).toBe(1)
})
it('releases a retained check permit only after late cleanup confirmation', async () => {
  const root = fixture(); let confirm: () => void = () => {}; const cleanupConfirmed = new Promise<void>(resolve => { confirm = resolve })
  const report = await checkProjectAsync(root, { execute: async () => ({ passed: false, summary: 'cleanup pending', cleanupUnconfirmed: true, cleanupConfirmed }) })
  expect(report.cleanupUnconfirmed).toBe(true); expect(sharedPoolStatus('check').activeUnits).toBe(1)
  confirm(); await new Promise(resolve => setTimeout(resolve, 10)); expect(sharedPoolStatus('check').activeUnits).toBe(0)
})
