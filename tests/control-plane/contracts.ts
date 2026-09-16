import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLedger, reserveBudget, settleBudget, budgetSummary, parseLedger, parseResources, parseUsage, CALL_ROLES, RESOURCE_KEYS, type Resources, type Usage } from '../../src/control-plane/budget.js'
import { parseAdmissionInput, planAdmission, normalizeScope, scopesOverlap, type AdmissionInput, type PlannedTask } from '../../src/control-plane/admission.js'
import { assessEvidence, parseEvidence, type EvidenceBinding, type VerificationEvidence } from '../../src/control-plane/evidence.js'
import { resolveOrcaExecutable, makeOrcaReadTransport, probeOrca, previewOrcaWorkerStart } from '../../src/control-plane/orca.js'
import { initializeLedger, readLedger, transactLedger } from '../../src/control-plane/store.js'
import { acquireLock, releaseLock } from '../../src/loop/lock.js'
import { ControlPlaneError } from '../../src/control-plane/validation.js'

/** Same assertions run in Vitest/CI and the dependency-free local runner. No paid engines. */
export const contractCases: { name: string; run: () => void | Promise<void> }[] = []
const check = (name: string, run: () => void | Promise<void>) => contractCases.push({ name, run })
const errorCode = (fn: () => unknown, code: string) => assert.throws(fn, error => error instanceof ControlPlaneError && error.code === code)
const resources = (n = 10): Resources => ({ tokens: n, costMicrousd: n, computeMs: n })
const limits = { ...resources(100), maxActive: 3 }
const fresh = () => createLedger(limits)
const request = (id = 'r1', taskId = 't1') => ({ id, taskId, role: 'worker' as const, requested: resources() })
const reserved = () => reserveBudget(fresh(), request()).ledger
const task = (id: string, scopes: string[] = [`src/${id}`], deps: string[] = []): PlannedTask => ({ id, profileId: 'dev', dependsOn: deps, writeScopes: scopes, requires: ['structured-result'], reservationId: `reservation:${id}`, requested: resources() })
const input = (tasks: PlannedTask[] = [task('one')]): AdmissionInput => ({ version: 1, runtime: { id: 'fixture', status: 'available', capabilities: { 'structured-result': 'supported' } }, ledger: fresh(), profiles: [{ id: 'dev', role: 'implementer', engine: 'codex', writeScopes: ['src', 'tests', '.yoke', '.git'] }], tasks, accepted: [], activeWrites: [], protectedScopes: ['tests/acceptance'] })
const binding: EvidenceBinding = { taskId: 't1', attemptId: 'a1', dispatchId: 'd1', snapshot: 'a'.repeat(64), acceptance: 'b'.repeat(64), policy: 'c'.repeat(64), environment: 'd'.repeat(64) }
const evidence = (): VerificationEvidence => ({ version: 1, stage: 'integrated', binding, checks: [{ id: 'acceptance', status: 'passed' }] })
function project(run: (root: string) => void): void { const root = mkdtempSync(join(tmpdir(), 'yoke-control-test-')); try { run(root) } finally { rmSync(root, { recursive: true, force: true }) } }

check('budget: creation and admission do not mutate inputs', () => { const before = fresh(); const next = reserveBudget(before, request()); assert.equal(before.reservations.length, 0); assert.equal(next.disposition, 'created'); assert.equal(next.ledger.reservations.length, 1) })
check('budget: in-flight consumption reserves all dimensions', () => { assert.deepEqual(budgetSummary(reserved()), { charged: resources(), active: 1, unknown: [], exceeded: [] }) })
check('budget: identical reservation is replay, not another launch', () => { const result = reserveBudget(reserved(), request()); assert.equal(result.disposition, 'replayed'); assert.equal(result.ledger.reservations.length, 1) })
check('budget: different request cannot reuse an id', () => { errorCode(() => reserveBudget(reserved(), { ...request(), taskId: 'other' }), 'idempotency_conflict') })
check('budget: a new id cannot duplicate an active task worker', () => { errorCode(() => reserveBudget(reserved(), request('r2')), 'task_already_running') })
check('budget: no budget is released on unconfirmed termination', () => { const ledger = reserved(); errorCode(() => settleBudget(ledger, 'r1', resources(), false), 'termination_unknown'); assert.equal(budgetSummary(ledger).active, 1) })
check('budget: actual zero is a measured zero, not missing usage', () => { assert.deepEqual(budgetSummary(settleBudget(reserved(), 'r1', resources(0), true)), { charged: resources(0), active: 0, unknown: [], exceeded: [] }) })
check('budget: confirmed settlement can free a permit', () => { const next = settleBudget(reserved(), 'r1', resources(4), true); assert.equal(reserveBudget(next, request('r2')).disposition, 'created'); assert.deepEqual(budgetSummary(next).charged, resources(4)) })
check('budget: settlement and settled reservation replay are idempotent', () => { const next = settleBudget(reserved(), 'r1', resources(4), true); assert.deepEqual(settleBudget(next, 'r1', resources(4), true), next); assert.equal(reserveBudget(next, request()).disposition, 'replayed') })
check('budget: conflicting settlements cannot rewrite billing', () => { errorCode(() => settleBudget(settleBudget(reserved(), 'r1', resources(4), true), 'r1', resources(2), true), 'idempotency_conflict') })
check('budget: unknown reservation settlement is rejected', () => { errorCode(() => settleBudget(fresh(), 'missing', resources(), true), 'unknown_reservation') })
for (const key of RESOURCE_KEYS) {
  check(`budget: unknown ${key} blocks further admission`, () => { const actual: Usage = { ...resources(3), [key]: null }; const next = settleBudget(reserved(), 'r1', actual, true); const summary = budgetSummary(next); assert.deepEqual(summary.unknown, [key]); assert.equal(summary.charged[key], 10); errorCode(() => reserveBudget(next, request('r2', 't2')), 'usage_unknown') })
  check(`budget: ${key} overrun is retained, never discarded`, () => { const next = settleBudget(reserved(), 'r1', { ...resources(1), [key]: 101 }, true); assert.equal(budgetSummary(next).charged[key], 101); errorCode(() => reserveBudget(next, request('r2', 't2')), 'budget_exceeded') })
  check(`budget: reservation cannot exceed remaining ${key}`, () => { errorCode(() => reserveBudget(reserved(), { ...request('r2', 't2'), requested: { ...resources(1), [key]: 91 } }), 'budget_exhausted') })
}
check('budget: equality with remaining budget is allowed', () => { const result = reserveBudget(reserved(), { ...request('r2', 't2'), requested: resources(90) }); assert.deepEqual(budgetSummary(result.ledger).charged, resources(100)) })
check('budget: global active-call limit applies before spend', () => { let ledger = createLedger({ ...limits, maxActive: 1 }); ledger = reserveBudget(ledger, request()).ledger; errorCode(() => reserveBudget(ledger, request('r2', 't2')), 'concurrency_exhausted') })
check('budget: every role consumes the same shared budget', () => { let ledger = createLedger({ ...limits, maxActive: 5 }); for (const role of CALL_ROLES) ledger = reserveBudget(ledger, { ...request(role, role), role }).ledger; assert.deepEqual(budgetSummary(ledger).charged, resources(50)); assert.equal(budgetSummary(ledger).active, 5) })
for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1']) check(`budget: invalid resource ${String(invalid)} is rejected`, () => { assert.throws(() => parseResources({ ...resources(), tokens: invalid })) })
check('budget: partial objects are rejected rather than zero-filled', () => { assert.throws(() => parseUsage({ tokens: null })); assert.throws(() => parseResources({ tokens: 0 })) })
check('budget: unknown fields and duplicate persisted ids are rejected', () => { assert.throws(() => parseLedger({ ...fresh(), ignored: true })); errorCode(() => parseLedger({ ...reserved(), reservations: [...reserved().reservations, ...reserved().reservations] }), 'duplicate_reservation') })
check('budget: aggregate overflow fails closed', () => { const ledger = { ...reserved(), reservations: [ ...reserved().reservations, { ...reserved().reservations[0]!, id: 'r2', taskId: 't2', requested: resources(Number.MAX_SAFE_INTEGER) } ] }; errorCode(() => budgetSummary(ledger), 'resource_overflow') })

check('admission: independent tasks share one deterministic wave', () => { const result = planAdmission(input([task('a'), task('b')])); assert.deepEqual(result.decisions.map(d => d.status), ['admitted', 'admitted']); assert.deepEqual(budgetSummary(result.ledger).charged, resources(20)) })
check('admission: just-admitted dependencies are not accepted', () => { const result = planAdmission(input([task('a'), task('b', ['src/b'], ['a'])])); assert.equal(result.decisions[1]!.reason, 'dependency_not_accepted') })
check('admission: accepted dependencies unblock tasks without redispatch', () => { const result = planAdmission({ ...input([task('a'), task('b', ['src/b'], ['a'])]), accepted: ['a'] }); assert.deepEqual(result.decisions.map(d => d.status), ['already-accepted', 'admitted']) })
check('admission: project order is retained instead of sorting IDs', () => { const result = planAdmission(input([task('z'), task('a')])); assert.deepEqual(result.decisions.map(d => d.taskId), ['z', 'a']) })
check('admission: no input mutation or persisted reservation', () => { const value = input(), before = JSON.stringify(value); planAdmission(value); assert.equal(JSON.stringify(value), before) })
check('admission: cyclic dependencies fail validation', () => { errorCode(() => planAdmission(input([task('a', ['src/a'], ['b']), task('b', ['src/b'], ['a'])])), 'dependency_cycle') })
check('admission: unknown dependency fails validation', () => { errorCode(() => planAdmission(input([task('a', ['src/a'], ['missing'])])), 'unknown_dependency') })
check('admission: unknown profile fails validation', () => { errorCode(() => planAdmission(input([{ ...task('a'), profileId: 'missing' }])), 'unknown_profile') })
check('admission: duplicate task IDs are rejected', () => { errorCode(() => planAdmission(input([task('a'), task('a')])), 'duplicate_id') })
check('admission: duplicate reservation IDs are rejected', () => { errorCode(() => planAdmission(input([task('a'), { ...task('b'), reservationId: 'reservation:a' }])), 'duplicate_id') })
check('admission: accepted set cannot name unknown tasks', () => { errorCode(() => planAdmission({ ...input(), accepted: ['missing'] }), 'unknown_task') })
check('admission: accepted set must respect dependencies', () => { errorCode(() => planAdmission({ ...input([task('a'), task('b', ['src/b'], ['a'])]), accepted: ['b'] }), 'invalid_acceptance') })
for (const status of ['unavailable', 'unknown'] as const) check(`admission: ${status} runtime is not silently local`, () => { const value = input(); assert.equal(planAdmission({ ...value, runtime: { ...value.runtime, status } }).decisions[0]!.reason, 'runtime_not_available') })
for (const support of ['unknown', 'unsupported', undefined] as const) check(`admission: capability ${String(support)} is not assumed supported`, () => { const value = input(); assert.equal(planAdmission({ ...value, runtime: { ...value.runtime, capabilities: support ? { 'structured-result': support } : {} } }).decisions[0]!.reason, 'capability_not_confirmed') })
check('admission: runtime metadata cannot silently add capabilities', () => { const value = input(); assert.throws(() => parseAdmissionInput({ ...value, runtime: { ...value.runtime, capabilities: { typo: 'supported' } } })) })
check('admission: undeclared write permission blocks work', () => { assert.equal(planAdmission(input([task('a', ['outside/file'])])).decisions[0]!.reason, 'scope_not_granted') })
for (const scope of ['tests/acceptance/test.ts', '.git/config', '.yoke/acceptance.yaml']) check(`admission: protected ${scope} is not writable`, () => { assert.equal(planAdmission(input([task('a', [scope])])).decisions[0]!.reason, 'protected_scope') })
check('admission: a parent scope overlaps protected children', () => { assert.equal(planAdmission(input([task('a', ['tests'])])).decisions[0]!.reason, 'protected_scope') })
check('admission: active writes and same-wave writes block collisions', () => { assert.equal(planAdmission({ ...input(), activeWrites: ['SRC'] }).decisions[0]!.reason, 'write_conflict'); const result = planAdmission(input([task('a', ['src/common']), task('b', ['src/common/file'])])); assert.equal(result.decisions[1]!.reason, 'write_conflict') })
check('admission: lookalike prefixes do not conflict', () => { assert.equal(scopesOverlap('src/a', 'src/ab'), false); assert.equal(scopesOverlap('SRC/A', 'src/a/test'), true) })
for (const scope of ['../secret', '/root', 'C:/root', 'src/../test', 'src//a', 'src\\a', 'src/*', 'src/a.', 'src/a ', '.', ' src/a']) check(`admission: unsafe scope ${scope} is rejected`, () => { assert.throws(() => normalizeScope(scope)) })
check('admission: exhausted budget returns a decision, not dispatch', () => { const value = input(); const result = planAdmission({ ...value, ledger: createLedger({ ...resources(1), maxActive: 1 }) }); assert.equal(result.decisions[0]!.reason, 'budget_exhausted'); assert.equal(result.ledger.reservations.length, 0) })
check('admission: replay never becomes a fresh launch authorization', () => { const value = input(); const prior = planAdmission(value); assert.equal(planAdmission({ ...value, ledger: prior.ledger }).decisions[0]!.status, 'already-reserved') })

check('evidence: matching integrated required checks pass', () => { assert.equal(assessEvidence(evidence(), binding, ['acceptance']).status, 'passed') })
check('evidence: candidate success is never integration acceptance', () => { assert.equal(assessEvidence({ ...evidence(), stage: 'candidate' }, binding, ['acceptance']).status, 'unverified') })
for (const key of ['snapshot', 'acceptance', 'policy', 'environment', 'taskId', 'attemptId', 'dispatchId'] as const) check(`evidence: changed ${key} invalidates receipt`, () => { const changed = { ...binding, [key]: key.endsWith('Id') ? 'different' : 'e'.repeat(64) }; assert.equal(assessEvidence(evidence(), changed, ['acceptance']).status, 'unverified') })
check('evidence: empty required set cannot pass vacuously', () => { assert.equal(assessEvidence(evidence(), binding, []).status, 'unverified') })
check('evidence: missing or unverified checks do not pass', () => { assert.equal(assessEvidence(evidence(), binding, ['acceptance', 'missing']).status, 'unverified'); assert.equal(assessEvidence({ ...evidence(), checks: [{ id: 'acceptance', status: 'unverified' }] }, binding, ['acceptance']).status, 'unverified') })
check('evidence: a failing additional check cannot be hidden', () => { assert.equal(assessEvidence({ ...evidence(), checks: [...evidence().checks, { id: 'other', status: 'failed' }] }, binding, ['acceptance']).status, 'failed') })
check('evidence: unverified extra checks remain unverified', () => { assert.equal(assessEvidence({ ...evidence(), checks: [...evidence().checks, { id: 'other', status: 'unverified' }] }, binding, ['acceptance']).status, 'unverified') })
check('evidence: duplicates and unsupported versions are rejected', () => { assert.throws(() => parseEvidence({ ...evidence(), checks: [...evidence().checks, ...evidence().checks] })); assert.throws(() => parseEvidence({ ...evidence(), version: 2 })) })
check('evidence: empty/malformed fingerprints cannot bind a receipt', () => { assert.throws(() => parseEvidence({ ...evidence(), binding: { ...binding, snapshot: '' } })) })

check('store: reading does not implicitly initialize state', () => project(root => { assert.equal(readLedger(root), null); assert.deepEqual(readdirSync(root), []) }))
check('store: explicit initialization survives a fresh read', () => project(root => { const saved = initializeLedger(root, limits); assert.deepEqual(readLedger(root), saved); assert.equal(saved.revision, 0) }))
check('store: initialization cannot erase a previous budget', () => project(root => { const saved = initializeLedger(root, limits); errorCode(() => initializeLedger(root, limits), 'ledger_exists'); assert.deepEqual(readLedger(root), saved) }))
check('store: budget uses the existing project lock', () => project(root => { const lock = acquireLock(root); assert.equal(lock.acquired, true); try { errorCode(() => initializeLedger(root, limits), 'project_busy') } finally { releaseLock(root, lock.ownerToken) } }))
check('store: stale revision is rejected inside the lock', () => project(root => { initializeLedger(root, limits); const saved = transactLedger(root, 0, ledger => reserveBudget(ledger, request()).ledger); assert.equal(saved.revision, 1); errorCode(() => transactLedger(root, 0, ledger => ledger), 'stale_revision') }))
check('store: idempotent replay keeps its revision', () => project(root => { initializeLedger(root, limits); transactLedger(root, 0, ledger => reserveBudget(ledger, request()).ledger); assert.equal(transactLedger(root, 1, ledger => reserveBudget(ledger, request()).ledger).revision, 1) }))
check('store: a failed transaction rolls back and releases the lock', () => project(root => { const saved = initializeLedger(root, limits); assert.throws(() => transactLedger(root, 0, () => { throw new Error('test abort') })); assert.deepEqual(readLedger(root), saved); assert.equal(transactLedger(root, 0, ledger => reserveBudget(ledger, request()).ledger).revision, 1) }))
check('store: callbacks cannot increase approved limits', () => project(root => { initializeLedger(root, limits); errorCode(() => transactLedger(root, 0, ledger => ({ ...ledger, limits: { ...limits, tokens: 999 } })), 'budget_policy_changed') }))
check('store: callbacks cannot erase charged history', () => project(root => { initializeLedger(root, limits); transactLedger(root, 0, ledger => reserveBudget(ledger, request()).ledger); errorCode(() => transactLedger(root, 1, ledger => ({ ...ledger, reservations: [] })), 'history_rewrite') }))
check('store: finalized usage cannot be rewritten', () => project(root => { initializeLedger(root, limits); transactLedger(root, 0, ledger => reserveBudget(ledger, request()).ledger); transactLedger(root, 1, ledger => settleBudget(ledger, 'r1', resources(3), true)); errorCode(() => transactLedger(root, 2, ledger => ({ ...ledger, reservations: ledger.reservations.map(item => ({ ...item, usage: resources(0) })) })), 'history_rewrite') }))
check('store: corrupt state is surfaced instead of reset', () => project(root => { initializeLedger(root, limits); writeFileSync(join(root, '.yoke/control-plane/budget.json'), '{'); assert.throws(() => readLedger(root)); assert.throws(() => initializeLedger(root, limits)) }))
check('store: state directory links are rejected before writes', () => project(root => project(outside => { symlinkSync(outside, join(root, '.yoke'), 'junction'); assert.throws(() => initializeLedger(root, limits), /Linked Yoke state/); assert.deepEqual(readdirSync(outside), []) })))
check('store: nested directory links are rejected', () => project(root => project(outside => { mkdirSync(join(root, '.yoke')); symlinkSync(outside, join(root, '.yoke/control-plane'), 'junction'); assert.throws(() => initializeLedger(root, limits), /Linked Yoke state/); assert.deepEqual(readdirSync(outside), []) })))
check('store: completed transaction leaves no temporary or lock files', () => project(root => { initializeLedger(root, limits); transactLedger(root, 0, ledger => reserveBudget(ledger, request()).ledger); assert.deepEqual(readdirSync(join(root, '.yoke')), ['control-plane']); assert.deepEqual(readdirSync(join(root, '.yoke/control-plane')), ['budget.json']); const raw = JSON.parse(readFileSync(join(root, '.yoke/control-plane/budget.json'), 'utf8')); assert.equal(raw.revision, 1) }))

check('orca: Linux does not launch the GNOME screenreader name', () => { assert.equal(resolveOrcaExecutable('linux', {}), 'orca-ide') })
check('orca: explicit managed-session executable takes precedence', () => { assert.equal(resolveOrcaExecutable('linux', { ORCA_CLI_COMMAND: '/custom/orca', ORCA_DEV_REPO_ROOT: '/dev' }), '/custom/orca') })
check('orca: dev and native Windows executable selection is explicit', () => { assert.equal(resolveOrcaExecutable('linux', { ORCA_DEV_REPO_ROOT: '/dev' }), 'orca-dev'); assert.equal(resolveOrcaExecutable('win32', {}), 'orca.exe'); assert.equal(resolveOrcaExecutable('darwin', {}), 'orca') })
check('orca: malformed executable override is rejected', () => { assert.throws(() => resolveOrcaExecutable('linux', { ORCA_CLI_COMMAND: '--help' })); assert.throws(() => resolveOrcaExecutable('linux', { ORCA_CLI_COMMAND: ' command\n' })) })
check('orca: read-only transport rejects mutation commands without execution', async () => { await assert.rejects(makeOrcaReadTransport('never-execute-this')(['open', '--json']), /Only the version-matched/) })
check('orca: read guide first and never infer capabilities from JSON', async () => { const calls: string[][] = []; const probe = await probeOrca(async args => { calls.push([...args]); return args[0] === 'skills' ? 'version-matched guide fixture' : '{"ok":true,"secret":"redact"}' }); assert.deepEqual(calls, [['skills', 'get', 'orca-cli'], ['status', '--json']]); assert.equal(probe.runtime.status, 'unknown'); assert.deepEqual(probe.runtime.capabilities, {}); assert.equal(probe.liveExecutionValidated, false); assert.equal(probe.guideDigest?.length, 64); assert.equal(JSON.stringify(probe).includes('redact'), false) })
check('orca: failed guide never triggers a fallback or another command', async () => { let calls = 0; const probe = await probeOrca(async () => { calls++; throw Object.assign(new Error('private-pairing-secret'), { code: 'ENOENT' }) }); assert.equal(calls, 1); assert.equal(probe.failedStep, 'guide'); assert.equal(probe.errorCode, 'ENOENT'); assert.equal(JSON.stringify(probe).includes('private-pairing-secret'), false) })
for (const response of ['{', 'null', '[]']) check(`orca: invalid response ${response} remains unverified`, async () => { const probe = await probeOrca(async args => args[0] === 'skills' ? 'guide' : response); assert.equal(probe.observation, 'invalid-response') })
check('orca: explicit runtime error is not success', async () => { const probe = await probeOrca(async args => args[0] === 'skills' ? 'guide' : '{"success":false}'); assert.equal(probe.observation, 'reported-error') })
check('orca: oversized guide fails before status', async () => { let calls = 0; const probe = await probeOrca(async () => { calls++; return 'x'.repeat(1024 * 1024 + 1) }); assert.equal(calls, 1); assert.equal(probe.observation, 'unavailable') })
check('orca: launch preview is literal argv with no effects', () => { const preview = previewOrcaWorkerStart({ taskId: 'task:1', name: 'fix', agent: 'codex', model: 'operator-selected-model', effort: 'high' }, 'fixture-orca'); assert.equal(preview.executable, 'fixture-orca'); assert.equal(preview.effects, 'none'); assert.equal(preview.requiresLiveContractValidation, true); assert.equal(preview.acceptanceAuthority, 'yoke'); assert.ok(preview.argv.includes('--model')); assert.ok(preview.argv.includes('operator-selected-model')) })
check('orca: unsupported model override is not silently dropped', () => { assert.throws(() => previewOrcaWorkerStart({ taskId: 't', name: 'fix', agent: 'opencode', model: 'x' }), /not validated/) })
check('orca: effort requires a model and allowed values', () => { assert.throws(() => previewOrcaWorkerStart({ taskId: 't', name: 'fix', agent: 'codex', effort: 'high' })); assert.throws(() => previewOrcaWorkerStart({ taskId: 't', name: 'fix', agent: 'codex', model: 'x', effort: 'invented' })) })
check('orca: option injection into model/id is rejected', () => { assert.throws(() => previewOrcaWorkerStart({ taskId: '--unsafe', name: 'fix', agent: 'codex' })); assert.throws(() => previewOrcaWorkerStart({ taskId: 't', name: 'fix', agent: 'codex', model: '--unsafe' })) })

check('store: a callback cannot bypass admission for new reservations', () => project(root => { initializeLedger(root, limits); errorCode(() => transactLedger(root, 0, ledger => ({ ...ledger, reservations: [{ ...request(), requested: resources(101), usage: null }] })), 'budget_exhausted'); assert.equal(readLedger(root)!.revision, 0) }))
check('store: settlement cannot be inserted without durable launch intent', () => project(root => { initializeLedger(root, limits); errorCode(() => transactLedger(root, 0, ledger => ({ ...ledger, reservations: [{ ...request(), usage: resources(0) }] })), 'invalid_new_reservation') }))
check('store: historical ordering cannot be rewritten', () => project(root => { initializeLedger(root, limits); transactLedger(root, 0, ledger => reserveBudget(reserveBudget(ledger, request()).ledger, request('r2', 't2')).ledger); errorCode(() => transactLedger(root, 1, ledger => ({ ...ledger, reservations: [...ledger.reservations].reverse() })), 'history_rewrite') }))
check('store: known overrun can be settled but prevents new work', () => project(root => { initializeLedger(root, limits); transactLedger(root, 0, ledger => reserveBudget(ledger, request()).ledger); transactLedger(root, 1, ledger => settleBudget(ledger, 'r1', resources(120), true)); assert.equal(budgetSummary(readLedger(root)!.ledger).charged.tokens, 120); errorCode(() => transactLedger(root, 2, ledger => reserveBudget(ledger, request('r2', 't2')).ledger), 'budget_exceeded') }))
check('budget: deterministic stress run conserves every resource', () => {
  let seed = 123456789
  const nextInt = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
  for (let trial = 0; trial < 100; trial++) {
    let ledger = createLedger({ ...resources(500), maxActive: 5 })
    for (let index = 0; index < 40; index++) {
      const amount = nextInt() % 30, id = `r${index}`
      try { ledger = reserveBudget(ledger, { ...request(id, `t${index}`), requested: resources(amount) }).ledger }
      catch (error) { assert.ok(error instanceof ControlPlaneError); assert.ok(['budget_exhausted', 'concurrency_exhausted'].includes(error.code)); continue }
      ledger = settleBudget(ledger, id, resources(nextInt() % (amount + 1)), true)
      const summary = budgetSummary(ledger)
      assert.equal(summary.active, 0); assert.deepEqual(summary.unknown, []); assert.deepEqual(summary.exceeded, [])
      const actual = ledger.reservations.reduce((sum, entry) => sum + entry.usage!.tokens!, 0)
      assert.deepEqual(summary.charged, resources(actual)); assert.ok(actual <= 500)
    }
  }
})
