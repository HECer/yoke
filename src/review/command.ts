import type { Agent } from '../retrofit/config.js'
import {
  agentInvocation,
  buildStandaloneReviewPrompt,
  buildWatchdogInvocation,
  runReviewAgent,
  isAgentAvailable,
  type Invocation,
  type AgentResult,
} from '../loop/runner.js'
import { resolveIdleMs } from '../loop/run-command.js'
import { existsSync, mkdirSync, rmSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from '../retrofit/config.js'
import { readReviewVerdict, reviewVerdictPath, type ReviewVerdict } from './verdict.js'

export interface RunReviewOptions {
  reviewer?: Agent
  base?: string
  focus?: string
  timeoutMinutes?: number
  isAvailable?: (a: Agent) => boolean
  run?: (inv: Invocation) => AgentResult
  implementer?: Agent
  allowSelfReview?: boolean
  json?: boolean
}

// Resolve to the first available agent, preferring a *second* model so the review
// is genuinely cross-model. claude last => a Claude-only box degrades to self-review.
const RESOLUTION_ORDER: Agent[] = ['codex', 'gemini', 'claude']

export function runReview(targetDir: string, opts: RunReviewOptions = {}): number {
  const available = opts.isAvailable ?? isAgentAvailable
  const implementer = opts.implementer ?? loadConfig(targetDir)?.agents[0] ?? 'claude'
  let reviewer = opts.reviewer
  if (reviewer) {
    if (!available(reviewer)) {
      console.error(`Reviewer agent CLI "${reviewer}" was not found on PATH. Install it, or pick another with --reviewer=<claude|codex|gemini>.`)
      return 2
    }
    if (reviewer === implementer && !opts.allowSelfReview) {
      console.error(`Reviewer "${reviewer}" is also the implementer. Pick another agent or pass --allow-self-review explicitly.`)
      return 2
    }
  } else {
    reviewer = RESOLUTION_ORDER.find(a => a !== implementer && available(a))
    if (!reviewer && opts.allowSelfReview && available(implementer)) reviewer = implementer
    if (!reviewer) {
      console.error('No independent reviewer CLI is available. Install a second agent, select one with --reviewer, or pass --allow-self-review explicitly.')
      return 2
    }
  }

  const scope = opts.base
    ? `the diff ${opts.base}..HEAD`
    : 'the uncommitted working-tree changes (working tree + staged)'
  const verdictPath = reviewVerdictPath(targetDir)
  const yokeDir = join(targetDir, '.yoke')
  const createdYokeDir = !existsSync(yokeDir)
  mkdirSync(yokeDir, { recursive: true })
  rmSync(verdictPath, { force: true })
  const prompt = buildStandaloneReviewPrompt(scope, opts.focus, verdictPath)
  const idleMs = resolveIdleMs(opts.timeoutMinutes, undefined)
  // Pass the *agent* invocation to the runner so callers (and tests) see the
  // reviewer command. The default runner adds the watchdog wrapper before exec;
  // an injected run() gets the raw invocation.
  const inv = agentInvocation(reviewer, prompt, targetDir, 'safe')

  const say = opts.json ? console.error : console.log
  say(`Reviewing ${scope} with ${reviewer}...`)
  const run = opts.run ?? ((i: Invocation) => runReviewAgent(buildWatchdogInvocation(i, idleMs)))
  const processResult = run(inv)
  let verdict: ReviewVerdict
  try {
    verdict = readReviewVerdict(verdictPath)
  } catch (error) {
    say(`✗ ${reviewer} produced no valid verdict (${(error as Error).message})${processResult.success ? '' : `; process: ${processResult.summary}`}`)
    if (createdYokeDir) { try { rmdirSync(yokeDir) } catch {} }
    return 1
  }
  if (createdYokeDir) { try { rmdirSync(yokeDir) } catch {} }
  if (opts.json) console.log(JSON.stringify({ reviewer, process: processResult, verdict }))
  if (!processResult.success) {
    say(`✗ ${reviewer} process failed (${processResult.summary}); verdict: ${verdict.summary}`)
    return 1
  }
  if (verdict.approved) {
    say(`✓ ${reviewer} approved: ${verdict.summary}`)
    return 0
  }
  say(`✗ ${reviewer} rejected: ${verdict.summary}`)
  return 1
}
