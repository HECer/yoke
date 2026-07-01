import type { Agent } from '../retrofit/config.js'
import {
  agentInvocation,
  buildStandaloneReviewPrompt,
  buildWatchdogInvocation,
  runAgent,
  isAgentAvailable,
  type Invocation,
  type AgentResult,
} from '../loop/runner.js'
import { resolveIdleMs } from '../loop/run-command.js'

export interface RunReviewOptions {
  reviewer?: Agent
  base?: string
  focus?: string
  timeoutMinutes?: number
  isAvailable?: (a: Agent) => boolean
  run?: (inv: Invocation) => AgentResult
}

// Resolve to the first available agent, preferring a *second* model so the review
// is genuinely cross-model. claude last => a Claude-only box degrades to self-review.
const RESOLUTION_ORDER: Agent[] = ['codex', 'gemini', 'claude']

export function runReview(targetDir: string, opts: RunReviewOptions = {}): number {
  const available = opts.isAvailable ?? isAgentAvailable
  let reviewer = opts.reviewer
  if (reviewer) {
    if (!available(reviewer)) {
      console.error(`Reviewer agent CLI "${reviewer}" was not found on PATH. Install it, or pick another with --reviewer=<claude|codex|gemini>.`)
      return 2
    }
  } else {
    reviewer = RESOLUTION_ORDER.find(a => available(a))
    if (!reviewer) {
      console.error('No agent CLI (claude|codex|gemini) found on PATH. Install one to run a review.')
      return 2
    }
    if (reviewer === 'claude') {
      console.log('Note: only Claude is available — this is a self-review, not cross-model.')
    }
  }

  const scope = opts.base
    ? `the diff ${opts.base}..HEAD`
    : 'the uncommitted working-tree changes (working tree + staged)'
  const prompt = buildStandaloneReviewPrompt(scope, opts.focus)
  const idleMs = resolveIdleMs(opts.timeoutMinutes, undefined)
  // Pass the *agent* invocation to the runner so callers (and tests) see the
  // reviewer command. The default runner adds the watchdog wrapper before exec;
  // an injected run() gets the raw invocation.
  const inv = agentInvocation(reviewer, prompt, targetDir)

  console.log(`Reviewing ${scope} with ${reviewer}...`)
  const run = opts.run ?? ((i: Invocation) => runAgent(buildWatchdogInvocation(i, idleMs)))
  const result = run(inv)
  if (result.success) {
    console.log(`✓ ${reviewer} approved`)
    return 0
  }
  console.log(`✗ ${reviewer} found issues (${result.summary})`)
  return 1
}
