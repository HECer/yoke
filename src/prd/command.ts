import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Agent } from '../retrofit/config.js'
import { loadConfig } from '../retrofit/config.js'
import { loadPrd, progress, type Story } from '../loop/prd.js'
import {
  agentInvocation,
  buildWatchdogInvocation,
  runAgent,
  isAgentAvailable,
  type Invocation,
  type AgentResult,
} from '../loop/runner.js'
import { resolveIdleMs } from '../loop/run-command.js'

export const PRD_TEMPLATE = `# Yoke PRD — the loop picks the lowest-priority open story each iteration.
# Story format (see canon/loop/prd.schema.md):
# - id: STORY-1
#   title: scaffold the project with a runnable test suite
#   priority: 1
#   acceptance:
#     - "the verify command exits 0"
#     - "a placeholder test exists and passes"
#   passes: false
[]
`

export function buildPrdDraftPrompt(idea: string): string {
  return [
    'You are drafting a PRD for the Yoke autonomous loop.',
    '',
    `Product idea: ${idea}`,
    '',
    'Break the idea into 5-12 small, independently shippable stories; each must fit one loop iteration.',
    'Each story needs:',
    '- id: STORY-1, STORY-2, ... (unique)',
    '- title: one imperative sentence',
    '- priority: dense integers from 1 (lower = built first)',
    '- acceptance: 2-5 testable, behavioral criteria (observable outcomes, never implementation steps)',
    '- passes: false',
    '',
    'If the project has no source code yet, STORY-1 must scaffold the project skeleton with a runnable',
    'test suite, and its acceptance must include that the verify command (verify.command in',
    '.yoke/config.yaml) exits 0.',
    '',
    'Write ONLY the file .yoke/prd.yaml as a YAML array of stories in exactly that shape.',
    'Do not modify any other file. Do not commit.',
  ].join('\n')
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
  const idea = opts.idea?.trim()
  if (!idea) {
    console.error('yoke prd draft requires --idea="..."')
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
  const agent: Agent = opts.runner ?? config?.agents[0] ?? 'claude'
  if (!available(agent)) {
    console.error(`Agent CLI "${agent}" was not found on PATH. Install it, or pick another with --runner=<claude|codex|gemini>.`)
    return 2
  }
  const idleMs = resolveIdleMs(opts.timeoutMinutes, undefined)
  const inv = agentInvocation(agent, buildPrdDraftPrompt(idea), targetDir)
  console.log(`Drafting PRD with ${agent}...`)
  const run = opts.run ?? ((i: Invocation) => runAgent(buildWatchdogInvocation(i, idleMs)))
  const result = run(inv)
  if (!result.success) {
    console.error(`PRD draft failed: ${result.summary}`)
    return 1
  }
  let count: number
  try {
    count = loadPrd(path).length
  } catch (e) {
    console.error(`PRD draft produced an invalid PRD: ${(e as Error).message}`)
    return 1
  }
  if (count === 0) {
    console.error('PRD draft failed: agent produced an empty PRD.')
    return 1
  }
  console.log(`Drafted ${count} stories → ${path}`)
  return 0
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
  if (stories.length === 0) errors.push('PRD has no stories')
  const seen = new Set<string>()
  for (const s of stories) {
    if (seen.has(s.id)) errors.push(`duplicate story id: ${s.id}`)
    seen.add(s.id)
    // the schema allows [], but the loop's stop-the-line gate blocks it — fail fast here
    if (s.acceptance.length === 0) errors.push(`story ${s.id} has no acceptance criteria`)
  }
  if (errors.length > 0) {
    for (const e of errors) console.error(`ERROR ${e}`)
    return 1
  }
  const p = progress(stories)
  console.log(`✓ PRD valid — ${p.total} stories, ${p.passed} pass`)
  return 0
}
