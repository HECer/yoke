import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { createQualityCommandHooks, type QualityCall } from '../../src/quality/command.js'
import { ProjectQualityDefaultsSchema } from '../../src/quality/types.js'
import { saveConfig, type YokeConfig } from '../../src/retrofit/config.js'
import { executionBudgetStatus } from '../../src/execution/budget.js'
import { requirementObjective } from '../../src/prd/requirements.js'
import { currentContractKey } from '../../src/routing/contracts.js'
import type { Story } from '../../src/loop/prd.js'

const roots: string[] = []
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
function project() {
  const root = mkdtempSync(join(tmpdir(), 'yoke-quality-budget-')); roots.push(root)
  vi.stubEnv('LOCALAPPDATA', ''); vi.stubEnv('XDG_STATE_HOME', join(root, 'host-state'))
  mkdirSync(join(root, '.yoke'))
  writeFileSync(join(root, 'reference.txt'), 'reference'); writeFileSync(join(root, 'candidate.txt'), 'candidate')
  const config: YokeConfig = { canonVersion: 'test', agents: ['codex'], loop: { enabled: true }, executionBudget: { id: 'work-package', maxCalls: 2 }, quality: ProjectQualityDefaultsSchema.parse({ enabled: true, consistencyChecks: 1, criticModel: 'requested-alias' }) }
  saveConfig(root, config)
  const story: Story = { id: 'S1', title: 'Repair scope', priority: 1, passes: false, writes: ['src'], acceptance: [{ id: 'repair', text: 'repair behavior', verify: ['npm run test:repair'] }, { id: 'preserve', text: 'preserve existing behavior', verify: ['npm run test:preserve'] }], quality: { reference: { name: 'reference', kind: 'file', source: 'reference.txt', digest: 'sha256:' + hash('reference') }, candidate: { kind: 'files', paths: ['candidate.txt'] }, rubric: 'Compare behavior' } }
  return { root, config, story }
}
const repair = { round: 1, source: 'quality' as const, finding: { severity: 'blocking' as const, message: 'repair the scoped behavior', actionable: true, evidence: ['observed failure'] } }

it('charges critics and worktree repairs once against the original project budget', () => {
  const { root, config, story } = project(), calls: QualityCall[] = []
  const worktree = join(root, 'worker'); mkdirSync(worktree)
  let executed = 0, completed = 0
  const hooks = createQualityCommandHooks({ targetDir: root, config, runnerAgent: 'codex', idleMs: 0, beforeCall: call => calls.push(call), afterCall: () => { completed++ }, runtime: { invoke: (_agent, invocation) => {
    executed++
    expect(invocation.execution?.root).toBe(root)
    const request = JSON.parse(invocation.input)
    if (request.role === 'quality-critic') {
      expect(invocation.cwd).not.toBe(root)
      const selected = request.bundles.find((bundle: { artifacts: Array<{ sha256: string }> }) => bundle.artifacts.some(artifact => artifact.sha256 === hash('candidate')))
      return { success: true, output: JSON.stringify({ schemaVersion: 1, attemptId: request.attemptId, winner: selected.label, biggestGap: 'none', evidence: ['observed'], confidence: 'high' }), summary: 'judged', tokens: { inputTokens: 10, outputTokens: 2, model: 'canonical-model' } }
    }
    return { success: true, output: 'repaired', summary: 'repaired', tokens: { inputTokens: 5, outputTokens: 1 } }
  } } })!
  expect(hooks.qualityPreflight({ targetDir: root, story }).kind).toBe('ready')
  expect(hooks.qualityStage({ targetDir: root, story }, 1).kind).toBe('pass')
  expect(hooks.repair({ targetDir: worktree, story }, repair).success).toBe(true)
  expect(hooks.repair({ targetDir: worktree, story }, { ...repair, round: 2 })).toMatchObject({ success: false, summary: expect.stringContaining('call limit') })
  expect(executed).toBe(2)
  expect(completed).toBe(3)
  expect(calls.map(call => call.role)).toEqual(['critic', 'repair', 'repair'])
  const status = executionBudgetStatus(root)
  if (!status.configured) throw Error('expected configured budget')
  expect(status.admittedCalls).toBe(2)
  expect(status.knownTokens).toBe(18)
  expect(status.calls.map(call => call.role)).toEqual(['critic', 'repair'])
})

it('applies beforeCall gates before invocation and supplies only the repair story requirements', () => {
  const { root, config, story } = project()
  const other = { ...story, id: 'S2', writes: ['other'], quality: undefined }
  writeFileSync(join(root, '.yoke', 'prd.yaml'), stringify([story, other]))
  writeFileSync(join(root, '.yoke', 'requirements.yaml'), stringify({ version: 1, objective: requirementObjective('Keep scoped behavior'), requirements: [
    { id: 'R1', text: 'SCOPED_REQUIREMENT', criteria: [{ story: 'S1', criterion: 'repair' }] },
    { id: 'R2', text: 'UNRELATED_REQUIREMENT', criteria: [{ story: 'S2', criterion: 'repair' }] },
  ], invariants: [] }))
  let prompt: { story: { writes: string[] }; settledContext: string } | undefined, invoked = 0
  const hooks = createQualityCommandHooks({ targetDir: root, config, runnerAgent: 'codex', idleMs: 0, beforeCall: call => { prompt = JSON.parse(call.invocation.input); throw Error('host admission stopped') }, runtime: { invoke: () => { invoked++; return { success: true, output: '', summary: 'unexpected' } } } })!
  expect(hooks.repair({ targetDir: root, story }, repair)).toMatchObject({ success: false, summary: expect.stringContaining('host admission stopped') })
  expect(invoked).toBe(0)
  expect(prompt?.story.writes).toEqual(['src'])
  expect(prompt?.settledContext).toContain('SCOPED_REQUIREMENT')
  expect(prompt?.settledContext).not.toContain('UNRELATED_REQUIREMENT')
})

it.each([['current', 1], ['stale', 2], ['unbound', 2]] as const)('only reduces adaptive calls for a %s contract-bound low-risk assessment', (binding, expectedCalls) => {
  const { root, config, story } = project()
  config.quality = ProjectQualityDefaultsSchema.parse({ ...config.quality, consistencyChecks: 'adaptive' })
  story.assessment = { taskClass: 'mechanical', risk: 'low', difficulty: 'low', uncertainty: 'low', scope: 'low', testability: 'high', reason: 'Scoped executable acceptance checks', approach: 'Repair the scoped file' }
  if (binding !== 'unbound') story.assessmentFor = currentContractKey(root, story)
  if (binding === 'stale') story.title = 'Changed contract after assessment'
  saveConfig(root, config)
  let calls = 0
  const hooks = createQualityCommandHooks({ targetDir: root, config, runnerAgent: 'codex', idleMs: 0, runtime: { invoke: (_agent, invocation) => {
    calls++
    const request = JSON.parse(invocation.input)
    const candidate = request.bundles.find((bundle: { artifacts: Array<{ sha256: string }> }) => bundle.artifacts.some(artifact => artifact.sha256 === hash('candidate')))
    return { success: true, output: JSON.stringify({ schemaVersion: 1, attemptId: request.attemptId, winner: candidate.label, biggestGap: 'none', evidence: ['observed'], confidence: 'high' }), summary: 'judged', tokens: { inputTokens: 1, outputTokens: 1, model: 'canonical-model' } }
  } } })!
  expect(hooks.qualityPreflight({ targetDir: root, story }).kind).toBe('ready')
  expect(hooks.qualityStage({ targetDir: root, story }, 1).kind).toBe('pass')
  expect(calls).toBe(expectedCalls)
})

it.each(['png', 'jpg'])('uses matching opaque filenames for reference and file-kind %s evidence', extension => {
  const { root, config, story } = project()
  story.quality!.reference.source = `reference.${extension}`
  story.quality!.candidate = { kind: 'files', paths: [`candidate.${extension}`] }
  // The fixture tests declared format naming; no image decoding or provider runs.
  writeFileSync(join(root, `reference.${extension}`), 'reference')
  writeFileSync(join(root, `candidate.${extension}`), 'candidate')
  const hooks = createQualityCommandHooks({ targetDir: root, config, runnerAgent: 'codex', idleMs: 0, runtime: { firstLabel: () => 'A', invoke: (_agent, invocation) => {
    const request = JSON.parse(invocation.input)
    expect(request.bundles.flatMap((bundle: { artifacts: Array<{ path: string }> }) => bundle.artifacts.map(artifact => artifact.path))).toEqual([`A-1.${extension}`, `B-1.${extension}`])
    return { success: true, output: JSON.stringify({ schemaVersion: 1, attemptId: request.attemptId, winner: 'A', biggestGap: 'none', evidence: ['observed'], confidence: 'high' }), summary: 'judged' }
  } } })!
  expect(hooks.qualityPreflight({ targetDir: root, story }).kind).toBe('ready')
  expect(hooks.qualityStage({ targetDir: root, story }, 1).kind).toBe('pass')
})
