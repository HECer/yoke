import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { loadConfig, saveConfig, defaultConfig, resolveVerifyCommand } from '../retrofit/config.js'
import { loadPrd, progress } from './prd.js'
import { runLoop } from './loop.js'
import { realGitOps } from './git.js'
import { makeRunner, makeReviewRunner, isAgentAvailable, type AgentRunner } from './runner.js'
import type { Agent } from '../retrofit/config.js'
import type { GitOps } from './gates.js'
import { commandVerifier, retryingVerifier, type Verifier } from './verify.js'
import { readStatus, makeReporter, type LoopReporter } from './reporter.js'

export const DEFAULT_IDLE_MINUTES = 20
const STALE_MINUTES = 20  // a running status older than this likely means the loop died

export function relativeTime(fromIso: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - Date.parse(fromIso))
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function prdPath(targetDir: string): string {
  return join(targetDir, '.yoke', 'prd.yaml')
}

export function setLoopEnabled(targetDir: string, enabled: boolean): void {
  // TODO(C2): resolve bundled canon version instead of placeholder
  const config = loadConfig(targetDir) ?? defaultConfig('0.0.0')
  config.loop = { enabled }
  saveConfig(targetDir, config)
}

export function loopStatus(targetDir: string, now: () => Date = () => new Date()): string {
  const config = loadConfig(targetDir)
  const enabled = config?.loop.enabled ?? false
  const path = prdPath(targetDir)
  let prog = 'no PRD'
  if (existsSync(path)) {
    const p = progress(loadPrd(path))
    prog = `${p.passed}/${p.total} stories pass`
  }
  const st = readStatus(targetDir)
  if (!st) return `Loop: ${enabled ? 'enabled' : 'disabled'}\nPRD: ${prog}`
  const head = `Loop: ${st.state.toUpperCase()}${st.story ? ` on ${st.story}${st.storyTitle ? ` "${st.storyTitle}"` : ''}` : ''}`
  const meta = [st.phase, `iteration ${st.iteration}`, `${st.progress.passed}/${st.progress.total}`, `updated ${relativeTime(st.updatedAt, now())}`]
    .filter(Boolean).join(' · ')
  const lines = [head, `  ${meta}`]
  if (st.reason) lines.push(`  reason: ${st.reason}`)
  const ageMs = now().getTime() - Date.parse(st.updatedAt)
  if (st.state === 'running' && ageMs > STALE_MINUTES * 60_000) {
    lines.push(`  ⚠ possibly stuck — no update in ${relativeTime(st.updatedAt, now())}`)
  }
  return lines.join('\n')
}

export function resolveIdleMs(flagMinutes: number | undefined, configMinutes: number | undefined): number {
  const minutes = flagMinutes ?? configMinutes ?? DEFAULT_IDLE_MINUTES
  return minutes > 0 ? minutes * 60_000 : 0
}

export interface RunLoopCommandOptions {
  maxIterations: number
  runner?: AgentRunner
  git?: GitOps
  verify?: Verifier
  agent?: Agent
  isAvailable?: (agent: Agent) => boolean
  isolate?: boolean
  reviewRunner?: AgentRunner
  reviewer?: Agent
  review?: boolean
  reporter?: LoopReporter
  timeoutMinutes?: number
}

export function runLoopCommand(targetDir: string, opts: RunLoopCommandOptions): number {
  const config = loadConfig(targetDir)
  if (!config?.loop.enabled) {
    console.error('Loop is disabled. Enable it with: yoke loop on')
    return 2
  }
  const path = prdPath(targetDir)
  if (!existsSync(path)) {
    console.error(`No PRD found at ${path}. Create one (see canon loop/prd.schema.md).`)
    return 2
  }
  let verify = opts.verify
  if (!verify) {
    const command = resolveVerifyCommand(targetDir, config)
    if (!command) {
      console.error('No verify command configured. Set verify.command in .yoke/config.yaml (e.g. "npm test") so the loop can confirm tests pass before marking work done.')
      return 2
    }
    verify = retryingVerifier(commandVerifier(command), config.verify?.retries ?? 1)
  }
  const available = opts.isAvailable ?? isAgentAvailable
  const runnerAgent: Agent = opts.agent ?? config.agents[0] ?? 'claude'

  const idleMs = resolveIdleMs(opts.timeoutMinutes, config.loop.timeoutMinutes)

  let runner = opts.runner
  if (!runner) {
    if (!available(runnerAgent)) {
      console.error(`Agent CLI "${runnerAgent}" was not found on PATH. Install it, or pick another with --runner=<claude|codex|gemini>.`)
      return 2
    }
    runner = makeRunner(runnerAgent, idleMs)
  }

  let review = opts.reviewRunner
  if (!review && (opts.review || opts.reviewer)) {
    const reviewerAgent: Agent = opts.reviewer ?? runnerAgent
    if (!available(reviewerAgent)) {
      console.error(`Reviewer agent CLI "${reviewerAgent}" was not found on PATH. Install it, or pick another with --reviewer=<claude|codex|gemini>.`)
      return 2
    }
    review = makeReviewRunner(reviewerAgent, idleMs)
  }

  const result = runLoop({
    prdPath: path,
    targetDir,
    runner,
    git: opts.git ?? realGitOps,
    verify,
    maxIterations: opts.maxIterations,
    isolate: opts.isolate ?? false,
    review,
    reporter: opts.reporter ?? makeReporter(targetDir),
  })
  console.log(`Loop ${result.status} after ${result.iterations} iteration(s): ${result.finalProgress.passed}/${result.finalProgress.total} stories pass`)
  if (result.reason) console.log(`Reason: ${result.reason}`)
  if (result.reason && /api key|please run \/login|not logged in/i.test(result.reason)) {
    console.log('Hint: the agent CLI has no credentials in this environment. Set ANTHROPIC_API_KEY or log the agent in for headless use.')
  }
  return result.status === 'complete' ? 0 : 1
}
