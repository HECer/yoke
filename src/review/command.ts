import type { Agent } from '../retrofit/config.js'
import {
  agentInvocation,
  buildStandaloneReviewPrompt,
  buildWatchdogInvocation,
  runCapturedAgent,
  repositoryFingerprint,
  isAgentAvailable,
  type Invocation,
  type CapturedAgentRun,
} from '../loop/runner.js'
import { parseProviderResult } from '../agents/telemetry.js'
import { resolveIdleMs } from '../loop/run-command.js'
import { loadConfig } from '../retrofit/config.js'
import { parseReviewVerdict } from './verdict.js'

export interface RunReviewOptions {
  reviewer?: Agent
  base?: string
  focus?: string
  timeoutMinutes?: number
  isAvailable?: (a: Agent) => boolean
  run?: (inv: Invocation) => CapturedAgentRun
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
  const prompt = buildStandaloneReviewPrompt(scope, opts.focus, undefined, reviewer)
  const idleMs = resolveIdleMs(opts.timeoutMinutes, undefined)
  // Pass the *agent* invocation to the runner so callers (and tests) see the
  // reviewer command. The default runner adds the watchdog wrapper before exec;
  // an injected run() gets the raw invocation.
  const inv = agentInvocation(reviewer, prompt, targetDir, 'read-only')

  const say = opts.json ? console.error : console.log
  say(`Reviewing ${scope} with ${reviewer}...`)
  const before = repositoryFingerprint(targetDir)
  const run = opts.run ?? ((i: Invocation) => runCapturedAgent(reviewer, buildWatchdogInvocation(i, idleMs)))
  const processResult = run(inv)
  if (repositoryFingerprint(targetDir) !== before) {
    say(`✗ ${reviewer} modified the repository during a read-only review`)
    return 1
  }
  try {
    const actualModel = opts.run ? undefined : processResult.tokens?.model
    if (!opts.run && processResult.success && !actualModel) throw new Error('review provider did not report its model')
    const verdict = parseReviewVerdict(parseProviderResult(reviewer, processResult.output), { provider: reviewer, ...(actualModel ? { model: actualModel } : {}) })
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
  } catch (error) {
    say(`✗ ${reviewer} produced no valid verdict (${(error as Error).message})${processResult.success ? '' : `; process: ${processResult.summary}`}`)
    return 1
  }
}
