import assert from 'node:assert/strict'
import { parseWorkspacePlan, planWorkspace, WORKSPACE_MODES, type WorkspacePlanInput, type WorkspaceParticipant } from '../../src/control-plane/workspace-plan.js'

export type WorkspaceTest = (name: string, run: () => void) => void
const participant = (id: string, purpose: WorkspaceParticipant['purpose'] = 'inspect', effects: WorkspaceParticipant['effects'] = 'read-only', consistency: WorkspaceParticipant['consistency'] = 'snapshot'): WorkspaceParticipant => ({ id, purpose, effects, consistency })
function fixture(): WorkspacePlanInput {
  return {
    version: 1, mode: 'auto', baseSnapshot: 'a'.repeat(64), inventory: 'complete', externalWriters: 0,
    guarantees: { readOnlyEnforcement: 'supported', exclusiveWriter: 'supported', stableSnapshot: 'supported', isolatedWorktrees: 'supported' },
    participants: [participant('reader')],
  }
}
function expectBlocked(input: unknown, reason: string): void {
  const result = planWorkspace(input)
  assert.equal(result.status, 'blocked'); assert.equal(result.mode, null)
  assert.deepEqual(result.reasons, [reason]); assert.deepEqual(result.stages, [])
  assert.equal(result.dispatchAuthorized, false); assert.equal(result.effects, 'none')
}
export function registerWorkspaceCases(test: WorkspaceTest): void {
  test('workspace: pure readers share one frozen base', () => {
    const result = planWorkspace({ ...fixture(), participants: [participant('r1'), participant('r2')] })
    assert.equal(result.mode, 'shared-read'); assert.equal(result.status, 'planned')
    assert.equal(result.stages.length, 1); assert.equal(result.stages[0].topology, 'frozen-shared-read')
    assert.deepEqual(result.stages[0].participants, ['r1', 'r2'])
  })
  test('workspace: single writer observes live but verifies only after integration', () => {
    const result = planWorkspace({ ...fixture(), participants: [participant('writer', 'implement', 'workspace-write'), participant('observer', 'inspect', 'read-only', 'live'), participant('qa', 'verify', 'read-only', 'live')] })
    assert.equal(result.mode, 'shared-single-writer')
    assert.deepEqual(result.stages.map(stage => stage.phase), ['implementation', 'integration', 'verification'])
    assert.deepEqual(result.stages[0].observers, ['observer'])
    assert.deepEqual(result.stages[2].participants, ['qa'])
    assert.equal(result.stages[2].snapshot, 'fresh-integrated')
    assert.ok(result.warnings.includes('live_observers_may_see_partial_edits'))
  })
  test('workspace: snapshot readers complete before mutable implementation', () => {
    const result = planWorkspace({ ...fixture(), participants: [participant('writer', 'implement', 'workspace-write'), participant('reader')] })
    assert.deepEqual(result.stages.map(stage => stage.phase), ['base-analysis', 'implementation', 'integration'])
    assert.deepEqual(result.stages[1].observers, [])
  })
  test('workspace: two writers isolate instead of using claimed nonoverlapping scopes', () => {
    const result = planWorkspace({ ...fixture(), participants: [participant('api', 'implement', 'workspace-write'), participant('ui', 'implement', 'workspace-write')] })
    assert.equal(result.mode, 'isolated-worktrees')
    assert.equal(result.stages[0].topology, 'worktree-per-writer')
    assert.equal(result.stages[1].topology, 'serial-integration')
    assert.ok(result.stages[0].guards.includes('session-owned-candidate-not-protected-target'))
    assert.ok(result.stages[1].guards.includes('confirm-candidate-writer-process-tree-stopped'))
  })
  test('workspace: an inspector with write effects counts as a writer', () => {
    const result = planWorkspace({ ...fixture(), participants: [participant('analysis', 'inspect', 'workspace-write')] })
    assert.equal(result.mode, 'shared-single-writer')
    assert.deepEqual(result.stages[0].participants, ['analysis'])
  })
  test('workspace: no promise of acceptance or dispatch from a plan', () => {
    const result = planWorkspace(fixture())
    assert.equal(result.effects, 'none'); assert.equal(result.dispatchAuthorized, false); assert.equal(result.preview, true)
    assert.ok(result.warnings.includes('existing_admission_budget_and_acceptance_still_required'))
  })
  test('workspace: unknown inventory cannot be ignored', () => expectBlocked({ ...fixture(), inventory: 'unknown' }, 'inventory_unknown'))
  test('workspace: active unowned writer blocks snapshot coordination', () => expectBlocked({ ...fixture(), externalWriters: 1 }, 'unowned_writer_active'))
  test('workspace: unknown effects do not become safe merely in a worktree', () => expectBlocked({ ...fixture(), mode: 'isolated-worktrees', participants: [participant('x', 'inspect', 'unknown')] }, 'effects_unknown'))
  for (const state of ['unsupported', 'unknown'] as const) {
    test(`workspace: ${state} snapshot stability blocks`, () => expectBlocked({ ...fixture(), guarantees: { ...fixture().guarantees, stableSnapshot: state } }, 'stable_snapshot_not_confirmed'))
    test(`workspace: ${state} read-only enforcement blocks nominal reviewers`, () => expectBlocked({ ...fixture(), guarantees: { ...fixture().guarantees, readOnlyEnforcement: state } }, 'read_only_not_enforced'))
    test(`workspace: ${state} writer fence falls back to isolated worktree in auto`, () => {
      const result = planWorkspace({ ...fixture(), guarantees: { ...fixture().guarantees, exclusiveWriter: state }, participants: [participant('writer', 'implement', 'workspace-write')] })
      assert.equal(result.mode, 'isolated-worktrees')
    })
    test(`workspace: ${state} writer fence blocks an explicit shared request`, () => expectBlocked({ ...fixture(), mode: 'shared-single-writer', guarantees: { ...fixture().guarantees, exclusiveWriter: state }, participants: [participant('writer', 'implement', 'workspace-write')] }, 'exclusive_writer_not_confirmed'))
    test(`workspace: ${state} worktree support never falls back to shared multiwriter`, () => expectBlocked({ ...fixture(), guarantees: { ...fixture().guarantees, isolatedWorktrees: state }, participants: [participant('a', 'implement', 'workspace-write'), participant('b', 'implement', 'workspace-write')] }, 'worktree_isolation_not_confirmed'))
  }
  test('workspace: shared-read rejects a writer', () => expectBlocked({ ...fixture(), mode: 'shared-read', participants: [participant('writer', 'implement', 'workspace-write')] }, 'shared_read_has_writer'))
  test('workspace: explicit shared single-writer rejects zero writers', () => expectBlocked({ ...fixture(), mode: 'shared-single-writer' }, 'shared_mode_requires_exactly_one_writer'))
  test('workspace: explicit shared single-writer rejects multiple writers', () => expectBlocked({ ...fixture(), mode: 'shared-single-writer', participants: [participant('a', 'implement', 'workspace-write'), participant('b', 'implement', 'workspace-write')] }, 'shared_mode_requires_exactly_one_writer'))
  test('workspace: isolated live readers are explicitly pinned to base', () => {
    const result = planWorkspace({ ...fixture(), mode: 'isolated-worktrees', participants: [participant('r', 'inspect', 'read-only', 'live'), participant('w', 'implement', 'workspace-write')] })
    assert.ok(result.warnings.includes('live_readers_pinned_to_base_not_all_candidates'))
    assert.equal(result.stages[0].snapshot, 'base'); assert.deepEqual(result.stages[1].observers, [])
  })
  test('workspace: writable test runners get separate disposable copies after integration', () => {
    const result = planWorkspace({ ...fixture(), participants: [participant('w', 'implement', 'workspace-write'), participant('test-a', 'verify', 'workspace-write'), participant('test-b', 'verify', 'workspace-write')] })
    assert.equal(result.mode, 'shared-single-writer')
    const verification = result.stages.at(-1)!
    assert.equal(verification.topology, 'disposable-per-verifier')
    assert.equal(verification.snapshot, 'fresh-integrated')
    assert.ok(verification.guards.includes('protect-code-and-acceptance-in-test-copy'))
    assert.deepEqual(verification.participants, ['test-a', 'test-b'])
  })
  test('workspace: a test-only workspace binds to base without pretending integration occurred', () => {
    const result = planWorkspace({ ...fixture(), participants: [participant('test', 'verify', 'workspace-write')] })
    assert.deepEqual(result.stages.map(stage => stage.phase), ['verification'])
    assert.equal(result.stages[0].snapshot, 'base'); assert.equal(result.stages[0].topology, 'disposable-per-verifier')
  })
  test('workspace: test output scratch requires isolation even when there are no implementers', () => expectBlocked({ ...fixture(), guarantees: { ...fixture().guarantees, isolatedWorktrees: 'unknown' }, participants: [participant('test', 'verify', 'workspace-write')] }, 'verification_scratch_isolation_not_confirmed'))
  test('workspace: readonly verify-only needs no worktree if stable readonly snapshot is confirmed', () => {
    const result = planWorkspace({ ...fixture(), guarantees: { ...fixture().guarantees, isolatedWorktrees: 'unsupported' }, participants: [participant('review', 'verify')] })
    assert.equal(result.status, 'planned'); assert.equal(result.stages[0].snapshot, 'base')
  })
  test('workspace: inputs are not mutated', () => {
    const input = fixture(), before = JSON.stringify(input)
    const result = planWorkspace(input)
    assert.equal(JSON.stringify(input), before)
    assert.notEqual(result.stages[0].participants, input.participants)
  })
  test('workspace: same input produces identical advice', () => assert.deepEqual(planWorkspace(fixture()), planWorkspace(fixture())))
  test('workspace: preserves supplied participant order within phases', () => {
    const result = planWorkspace({ ...fixture(), participants: [participant('z'), participant('a')] })
    assert.deepEqual(result.stages[0].participants, ['z', 'a'])
  })
  const malformed: [string, unknown][] = [
    ['null', null], ['array', []], ['version', { ...fixture(), version: 2 }],
    ['mode', { ...fixture(), mode: 'shared-multiwriter' }],
    ['digest', { ...fixture(), baseSnapshot: 'HEAD' }],
    ['uppercase digest', { ...fixture(), baseSnapshot: 'A'.repeat(64) }],
    ['negative writers', { ...fixture(), externalWriters: -1 }],
    ['fractional writers', { ...fixture(), externalWriters: 0.5 }],
    ['infinite writers', { ...fixture(), externalWriters: Infinity }],
    ['duplicate id', { ...fixture(), participants: [participant('a'), participant('a')] }],
    ['empty members', { ...fixture(), participants: [] }],
    ['extra field', { ...fixture(), launch: true }],
    ['extra guarantee', { ...fixture(), guarantees: { ...fixture().guarantees, sandbox: 'supported' } }],
    ['missing guarantee', { ...fixture(), guarantees: {} }],
    ['missing effects', { ...fixture(), participants: [{ id: 'a', purpose: 'verify', consistency: 'snapshot' }] }],
    ['extra participant field', { ...fixture(), participants: [{ ...participant('a'), accepted: true }] }],
    ['unsafe participant id', { ...fixture(), participants: [participant('../x')] }],
    ['unknown purpose', { ...fixture(), participants: [{ ...participant('a'), purpose: 'admin' }] }],
    ['unknown consistency', { ...fixture(), participants: [{ ...participant('a'), consistency: 'maybe' }] }],
    ['too many members', { ...fixture(), participants: Array.from({ length: 101 }, (_, i) => participant(`r${i}`)) }],
  ]
  for (const [name, value] of malformed) test(`workspace: rejects ${name}`, () => assert.throws(() => parseWorkspacePlan(value)))
  for (const mode of WORKSPACE_MODES) for (const writers of [0, 1, 2, 3]) {
    test(`workspace: invariant mode=${mode} writers=${writers}`, () => {
      const result = planWorkspace({ ...fixture(), mode, participants: [participant('reader'), participant('review', 'verify'), ...Array.from({ length: writers }, (_, i) => participant(`writer-${i}`, 'implement', 'workspace-write'))] })
      assert.equal(result.dispatchAuthorized, false)
      if (result.status === 'blocked') { assert.deepEqual(result.stages, []); return }
      for (const stage of result.stages) {
        if (stage.topology === 'shared-single-writer') assert.equal(stage.participants.length, 1)
        if (stage.phase === 'verification') { assert.equal(stage.observers.length, 0); assert.notEqual(stage.snapshot, 'mutable-candidate') }
      }
      if (writers) {
        const integration = result.stages.findIndex(stage => stage.phase === 'integration')
        const verification = result.stages.findIndex(stage => stage.phase === 'verification')
        assert.ok(integration >= 0 && verification > integration)
      }
    })
  }
}
