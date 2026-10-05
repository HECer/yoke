import { existsSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Agent } from '../retrofit/config.js'
import { loadConfig } from '../retrofit/config.js'
import { acceptanceText, criterionCommandProblem, isAcceptanceCriterion, loadPrd, parsePrd, savePrd, progress, validateDependencies, type Story } from '../loop/prd.js'
import { assessmentInstructions } from '../routing/assessment.js'
import { bindAssessments, preparedProblems } from './assess.js'
import { resolvePlanner } from '../routing/planning.js'
import { readPlanningFile } from '../routing/contracts.js'
import { acquireLock, releaseLock } from '../loop/lock.js'
import {
  agentInvocation,
  buildWatchdogInvocation,
  runCapturedAgent,
  isAgentAvailable,
  type Invocation,
  type AgentResult,
} from '../loop/runner.js'
import { resolveIdleMs } from '../loop/run-command.js'
import { detectHostAgent, resolveRunnerAgent } from '../agents/host.js'
import { measureInvocation } from '../observability/invocation.js'
import { statePath } from '../workspace/state.js'
import { MAX_REQUIREMENTS_BYTES, readRequirements, requirementObjective, requirementsDigest, validateRequirements } from './requirements.js'

export const PRD_TEMPLATE = `# Yoke PRD — the loop picks the lowest-priority open story each iteration.
# Story format (see canon/loop/prd.schema.md):
# - id: STORY-1
#   title: scaffold the project with a runnable test suite
#   priority: 1
#   needs: []             # optional story IDs that must pass first
#   area: foundation      # optional collision domain for parallel runs
#   agent: codex          # optional Yoke harness affinity
#   acceptance:
#     - id: suite-runs
#       text: "the project test suite can run"
#       verify: ["npm run test:suite-runs"]
#     - id: scaffold-starts
#       text: "the scaffolded application starts"
#       verify: ["npm run test:scaffold-starts"]
#   passes: false
[]
`

export const MAX_PLANNING_BRIEF_CHARS = 20_000
export const MAX_PLANNING_BRIEF_BYTES = MAX_PLANNING_BRIEF_CHARS * 4

export function buildPrdDraftPrompt(idea: string, planningBrief?: string): string {
  const lines = [
    'You are drafting a PRD for the Yoke autonomous loop.',
    '',
    `Product idea: ${idea}`,
  ]
  if (planningBrief?.trim()) {
    lines.push(
      '',
      '## Approved planning brief (treat these decisions as settled)',
      planningBrief.trim(),
      '',
      'Do not reopen settled choices or invent alternatives that contradict this brief.',
    )
  }
  lines.push(
    '',
    'Use the smallest coherent decomposition into 1-12 stories; each must fit one loop iteration.',
    'Give shared contracts/files one explicit owner, stabilize interfaces first, and make parallel components depend on that owner. Order overlapping write scopes through needs.',
    'Each story needs:',
    '- id: STORY-1, STORY-2, ... (unique)',
    '- title: one imperative sentence',
    '- priority: dense integers from 1 (lower = built first)',
    '- needs: optional list of story IDs that must pass first; the graph must be acyclic',
    '- area: optional collision domain for safe parallel scheduling',
    '- agent: optional harness affinity (claude, codex, gemini, qwen, opencode, kilo, pi, or hermes)',
    '- acceptance: 2-5 testable, behavioral criteria (observable outcomes, never implementation steps)',
    '  Each criterion is an object with a stable id, behavioral text, and verify: [one or more approved test commands].',
    '  Every criterion id must appear in every verify command; use one test command without shell control operators.',
    '- passes: false',
    '- requirementsFor: host-owned original-objective binding; preserve existing bindings on retained stories and omit it on new stories. Yoke activates bindings after validating this draft.',
    '- writes: explicit relative write scopes for safe scheduling',
    assessmentInstructions,
    'Include a complete assessment on every story in this same planning pass. Do not choose worker model names; the scheduler does that.',
    '',
    'If the project has no source code yet, STORY-1 must scaffold the project skeleton with a runnable',
    'test suite, and its acceptance must include that the verify command (verify.command in',
    '.yoke/config.yaml) exits 0.',
    '',
    'Write .yoke/prd.yaml as a YAML array of stories in exactly that shape.',
    'Also write .yoke/requirements.yaml as a version: 1 requirement ledger.',
    `Copy this exact objective object without summarizing or changing it: ${JSON.stringify(requirementObjective(idea, planningBrief))}`,
    'requirements: 1-100 entries; invariants: 0-50 entries. Every entry has a globally unique id, text (maximum 2000 characters), and criteria: [{story: STORY-1, criterion: criterion-id}] with 1-50 unique references.',
    'Extract every approved requirement and preserved invariant from the original idea and approved brief; map them to executable criteria. Do not redefine requirements through story summaries.',
    'The ledger must be at most 200000 bytes. Complete mechanical coverage does not prove semantic completeness: review original intent, preserved capabilities and boundary behavior.',
    'Modify only these two files. Do not commit.',
  )
  return lines.join('\n')
}

export interface PrdDraftOptions {
  idea: string
  runner?: Agent
  force?: boolean
  timeoutMinutes?: number
  isAvailable?: (a: Agent) => boolean
  run?: (inv: Invocation) => AgentResult
}

export function prdFile(targetDir: string): string {
  return join(targetDir, '.yoke', 'prd.yaml')
}

export function runPrdDraft(targetDir: string, opts: PrdDraftOptions): number {
  const idea = opts.idea
  if (!idea?.trim()) {
    console.error('yoke prd draft requires --idea="..."')
    return 1
  }
  if (idea.length > MAX_PLANNING_BRIEF_CHARS) {
    console.error(`Original idea is too large (${idea.length} characters; maximum ${MAX_PLANNING_BRIEF_CHARS}).`)
    return 1
  }
  const path = prdFile(targetDir)
  if (existsSync(path) && !opts.force) {
    try {
      const existing = loadPrd(path)
      if (existing.length > 0) {
        console.error(`PRD already has ${existing.length} stories — use --force to overwrite.`)
        return 1
      }
    } catch {
      // an unparseable PRD is likely a hand-edit typo, not consent to overwrite
      console.error('Existing .yoke/prd.yaml is unparseable — fix it, or pass --force to overwrite it.')
      return 1
    }
  }
  const available = opts.isAvailable ?? isAgentAvailable
  const config = loadConfig(targetDir)
  const planner = resolvePlanner(config, resolveRunnerAgent(config, undefined, detectHostAgent()), config?.runner, opts.runner)
  const agent = planner.agent
  if (!available(agent)) {
    console.error(`Agent CLI "${agent}" was not found on PATH. Install it, or pick another with --runner=<claude|codex|gemini|qwen|opencode|kilo|pi|hermes>.`)
    return 2
  }
  const idleMs = resolveIdleMs(opts.timeoutMinutes, undefined)
  const planPath = join(targetDir, '.yoke', 'plan.md')
  if (existsSync(planPath) && statSync(planPath).size > MAX_PLANNING_BRIEF_BYTES) {
    console.error(`Approved plan is too large (${statSync(planPath).size} bytes; maximum ${MAX_PLANNING_BRIEF_BYTES}). Split or condense .yoke/plan.md before drafting the PRD.`)
    return 1
  }
  const planningBrief = existsSync(planPath) ? readFileSync(planPath, 'utf8') : undefined
  if (planningBrief && planningBrief.length > MAX_PLANNING_BRIEF_CHARS) {
    console.error(`Approved plan is too large (${planningBrief.length} characters; maximum ${MAX_PLANNING_BRIEF_CHARS}). Split or condense .yoke/plan.md before drafting the PRD.`)
    return 1
  }
  const lock = acquireLock(targetDir)
  if (!lock.acquired) { console.error('A loop or planner already owns this project'); return 1 }
  try {
  const before = readPlanningFile(targetDir, '.yoke/prd.yaml')
  const beforeRequirements = readPlanningFile(targetDir, '.yoke/requirements.yaml', MAX_REQUIREMENTS_BYTES)
  const priorBindings = new Map<string, string>()
  if (before !== undefined) {
    try { for (const story of parsePrd(path)) if (story.requirementsFor) priorBindings.set(story.id, story.requirementsFor) }
    catch { /* Explicit force may replace malformed legacy planning state. */ }
  }
  const rollback = () => {
    const destination = join(statePath(targetDir), 'prd.yaml')
    // Unlink a provider-created file link instead of writing through it.
    rmSync(destination, { force: true })
    if (before !== undefined) writeFileSync(destination, before, { flag: 'wx' })
    const requirementsDestination = join(statePath(targetDir), 'requirements.yaml')
    rmSync(requirementsDestination, { force: true })
    if (beforeRequirements !== undefined) writeFileSync(requirementsDestination, beforeRequirements, { flag: 'wx' })
  }
  const inv = agentInvocation(agent, buildPrdDraftPrompt(idea, planningBrief), targetDir, 'safe', planner.selection)
  console.log(`Drafting PRD with ${agent}...`)
  const run = opts.run ?? ((i: Invocation) => runCapturedAgent(agent, buildWatchdogInvocation(i, idleMs)))
  let result: AgentResult
  try { result = measureInvocation({ root: targetDir, agent, role: 'prd-draft', selection: planner.selection, invocation: inv, execute: run }) }
  catch (error) {
    rollback()
    console.error(`PRD draft failed: ${(error as Error).message}`)
    return 1
  }
  if (!result.success) {
    rollback()
    console.error(`PRD draft failed: ${result.summary}`)
    return 1
  }
  let count: number
  try {
    if (readPlanningFile(targetDir, '.yoke/plan.md', MAX_PLANNING_BRIEF_BYTES) !== planningBrief) throw Error('Approved planning brief changed during drafting')
    const requirementDigest = requirementsDigest(targetDir)
    // A forced draft may intentionally replace the objective. Validate provider
    // marker continuity before the host activates that newly authorized binding.
    let drafted = parsePrd(path)
    const graphProblems = validateDependencies(drafted)
    if (graphProblems.length) throw Error(`Invalid PRD dependency graph: ${graphProblems.join('; ')}`)
    for (const story of drafted) if (priorBindings.has(story.id) && story.requirementsFor !== priorBindings.get(story.id)) throw Error(`Planner changed or removed original objective binding for ${story.id}`)
    const ledger = readRequirements(targetDir)
    if (!ledger) throw Error('New drafts require .yoke/requirements.yaml coverage')
    for (const story of drafted) if (!priorBindings.has(story.id) && story.requirementsFor !== undefined && story.requirementsFor !== ledger.objective.sha256) throw Error(`Planner supplied an invalid original objective binding for ${story.id}`)
    drafted = drafted.map(story => ({ ...story, requirementsFor: ledger.objective.sha256 }))
    validateRequirements(ledger, drafted, planningBrief, idea)
    drafted = bindAssessments(drafted, planningBrief, requirementDigest)
    count = drafted.length
    if (count > 12) throw Error('New drafts must use 1-12 coherent stories')
    if (drafted.some(s => s.passes)) throw Error('New stories must not already be passed')
    if (config?.routing?.assessmentPolicy === 'prepared') {
      if (drafted.some(s => s.passes)) throw Error('New stories must not already be passed')
      const issues = preparedProblems(drafted, planningBrief, requirementDigest)
      if (issues.length) throw Error(issues.join('; '))
    }
    if (count) savePrd(path, drafted)
  } catch (e) {
    rollback()
    console.error(`PRD draft produced an invalid PRD: ${(e as Error).message}`)
    return 1
  }
  if (count === 0) {
    rollback()
    console.error('PRD draft failed: agent produced an empty PRD.')
    return 1
  }
  console.log(`Drafted ${count} stories → ${path}`)
  return 0
  } finally { releaseLock(targetDir, lock.ownerToken) }
}

export function runPrdCheck(targetDir: string): number {
  const path = prdFile(targetDir)
  if (!existsSync(path)) {
    console.error(`No PRD at ${path} — create one with yoke prd draft or yoke new.`)
    return 1
  }
  let stories: Story[]
  try {
    stories = loadPrd(path)
  } catch (e) {
    console.error(`Invalid PRD: ${(e as Error).message}`)
    return 1
  }
  const errors: string[] = []
  if (loadConfig(targetDir)?.routing?.assessmentPolicy === 'prepared') errors.push(...preparedProblems(stories, readPlanningFile(targetDir, '.yoke/plan.md', 80_000) ?? '', requirementsDigest(targetDir)))
  const requireCriteria = loadConfig(targetDir)?.verify?.requireCriteria ?? false
  if (stories.length === 0) errors.push('PRD has no stories')
  const seen = new Set<string>()
  for (const s of stories) {
    if (seen.has(s.id)) errors.push(`duplicate story id: ${s.id}`)
    seen.add(s.id)
    // the schema allows [], but the loop's stop-the-line gate blocks it — fail fast here
    if (s.acceptance.length === 0) errors.push(`story ${s.id} has no acceptance criteria`)
    if (requireCriteria && s.acceptance.some(criterion => !isAcceptanceCriterion(criterion))) {
      errors.push(`story ${s.id} lacks executable criterion evidence`)
    }
    for (const criterion of s.acceptance.filter(isAcceptanceCriterion)) {
      const problem = criterionCommandProblem(criterion)
      if (problem) errors.push(problem)
    }
    if (s.acceptance.some(criterion => /\b(?:TBD|TODO|TO BE DECIDED|DECIDE LATER)\b|\?\?\?/i.test(acceptanceText(criterion)))) {
      errors.push(`story ${s.id} has unresolved planning decisions in acceptance criteria`)
    }
  }
  if (errors.length > 0) {
    for (const e of errors) console.error(`ERROR ${e}`)
    return 1
  }
  const p = progress(stories)
  console.log(`✓ PRD valid — ${p.total} stories, ${p.passed} pass`)
  if (!readRequirements(targetDir)) console.log('Legacy PRD: original-objective, requirement and invariant coverage are not checked. Add .yoke/requirements.yaml for the stronger contract.')
  return 0
}
