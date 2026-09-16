import { beforeEach, afterEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializeLedger, readLedger, transactLedgerOwned } from '../../src/control-plane/store.js'
import { reserveBudget, settleBudget } from '../../src/control-plane/budget.js'
import { acquireLock, releaseLock, readLock } from '../../src/loop/lock.js'

let root: string, token: string
const request = { id: 'one', taskId: 'story', role: 'worker' as const, requested: { tokens: 0, costMicrousd: 0, computeMs: 10 } }
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'yoke-owned-ledger-'))
  initializeLedger(root, { tokens: 0, costMicrousd: 0, computeMs: 100, maxActive: 1 })
  token = acquireLock(root).ownerToken!
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })
it('borrows the actual loop lock without reacquiring or releasing it', () => {
  const reserved = transactLedgerOwned(root, token, 0, ledger => reserveBudget(ledger, request).ledger)
  expect(reserved.revision).toBe(1); expect(readLock(root)?.ownerToken).toBe(token)
  const settled = transactLedgerOwned(root, token, 1, ledger => settleBudget(ledger, 'one', { tokens: 0, costMicrousd: 0, computeMs: 4 }, true))
  expect(settled.revision).toBe(2); expect(readLock(root)?.ownerToken).toBe(token)
})
it('requires the current process and exact owner token before executing the callback', () => {
  const callback = () => { throw new Error('callback must not run') }
  expect(() => transactLedgerOwned(root, 'wrong', 0, callback)).toThrow(/own the existing/)
  releaseLock(root, token)
  expect(() => transactLedgerOwned(root, token, 0, callback)).toThrow(/own the existing/)
  writeFileSync(join(root, '.yoke/loop.lock'), JSON.stringify({ pid: process.pid + 1, ownerToken: token }))
  expect(() => transactLedgerOwned(root, token, 0, callback)).toThrow(/own the existing/)
})
it('rechecks ownership after the callback and preserves a successor lock', () => {
  expect(() => transactLedgerOwned(root, token, 0, ledger => {
    writeFileSync(join(root, '.yoke/loop.lock'), JSON.stringify({ pid: process.pid, ownerToken: 'successor' }))
    return reserveBudget(ledger, request).ledger
  })).toThrow(/own the existing/)
  expect(readLedger(root)?.revision).toBe(0)
  expect(readLock(root)?.ownerToken).toBe('successor')
})
it('blocks takeover uncertainty and stale revisions', () => {
  expect(() => transactLedgerOwned(root, token, 1, ledger => ledger)).toThrow(/changed/)
  writeFileSync(join(root, '.yoke/loop.lock.takeover'), '{}')
  expect(() => transactLedgerOwned(root, token, 0, ledger => ledger)).toThrow(/own the existing/)
})
it('blocks nested transactions and releases the in-process guard after a throw', () => {
  expect(() => transactLedgerOwned(root, token, 0, ledger => {
    transactLedgerOwned(root, token, 0, x => x); return ledger
  })).toThrow(/Nested/)
  expect(transactLedgerOwned(root, token, 0, x => x).revision).toBe(0)
})
it('retains limit and append-only-history enforcement on the owned path', () => {
  transactLedgerOwned(root, token, 0, ledger => reserveBudget(ledger, request).ledger)
  expect(() => transactLedgerOwned(root, token, 1, ledger => ({ ...ledger, reservations: [] }))).toThrow(/history/)
  expect(() => transactLedgerOwned(root, token, 1, ledger => ({ ...ledger, limits: { ...ledger.limits, tokens: 1 } }))).toThrow(/limits/)
  expect(readLedger(root)?.revision).toBe(1)
})
it('detects even an equal-revision ledger replacement during a callback', () => {
  const file = join(root, '.yoke/control-plane/budget.json')
  expect(() => transactLedgerOwned(root, token, 0, ledger => {
    const old = JSON.parse(readFileSync(file, 'utf8')); old.ledger.limits.computeMs = 99
    writeFileSync(file, JSON.stringify(old)); return reserveBudget(ledger, request).ledger
  })).toThrow(/changed during/)
  expect(readLedger(root)?.ledger.reservations).toHaveLength(0)
})
