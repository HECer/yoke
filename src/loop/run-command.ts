import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { loadConfig, saveConfig, defaultConfig, resolveVerifyCommand } from '../retrofit/config.js'
import { loadPrd, progress } from './prd.js'
import { runLoop } from './loop.js'
import { realGitOps } from './git.js'
import { makeRunner, isAgentAvailable, type AgentRunner } from './runner.js'
import type { Agent } from '../retrofit/config.js'
import type { GitOps } from './gates.js'
import { commandVerifier, type Verifier } from './verify.js'

export function prdPath(targetDir: string): string {
  return join(targetDir, '.forge', 'prd.yaml')
}

export function setLoopEnabled(targetDir: string, enabled: boolean): void {
  // TODO(C2): resolve bundled canon version instead of placeholder
  const config = loadConfig(targetDir) ?? defaultConfig('0.0.0')
  config.loop = { enabled }
  saveConfig(targetDir, config)
}

export function loopStatus(targetDir: string): string {
  const config = loadConfig(targetDir)
  const enabled = config?.loop.enabled ?? false
  const path = prdPath(targetDir)
  let prog = 'no PRD'
  if (existsSync(path)) {
    const p = progress(loadPrd(path))
    prog = `${p.passed}/${p.total} stories pass`
  }
  return `Loop: ${enabled ? 'enabled' : 'disabled'}\nPRD: ${prog}`
}

export interface RunLoopCommandOptions {
  maxIterations: number
  runner?: AgentRunner
  git?: GitOps
  verify?: Verifier
  agent?: Agent
  isAvailable?: (agent: Agent) => boolean
  isolate?: boolean
}

export function runLoopCommand(targetDir: string, opts: RunLoopCommandOptions): number {
  const config = loadConfig(targetDir)
  if (!config?.loop.enabled) {
    console.error('Loop is disabled. Enable it with: forge loop on')
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
      console.error('No verify command configured. Set verify.command in .forge/config.yaml (e.g. "npm test") so the loop can confirm tests pass before marking work done.')
      return 2
    }
    verify = commandVerifier(command)
  }
  let runner = opts.runner
  if (!runner) {
    const agent: Agent = opts.agent ?? config.agents[0] ?? 'claude'
    const available = opts.isAvailable ?? isAgentAvailable
    if (!available(agent)) {
      console.error(`Agent CLI "${agent}" was not found on PATH. Install it, or pick another with --runner=<claude|codex|gemini>.`)
      return 2
    }
    runner = makeRunner(agent)
  }
  const result = runLoop({
    prdPath: path,
    targetDir,
    runner,
    git: opts.git ?? realGitOps,
    verify,
    maxIterations: opts.maxIterations,
    isolate: opts.isolate ?? false,
  })
  console.log(`Loop ${result.status} after ${result.iterations} iteration(s): ${result.finalProgress.passed}/${result.finalProgress.total} stories pass`)
  if (result.reason) console.log(`Reason: ${result.reason}`)
  if (result.reason && /api key|please run \/login|not logged in/i.test(result.reason)) {
    console.log('Hint: the agent CLI has no credentials in this environment. Set ANTHROPIC_API_KEY or log the agent in for headless use.')
  }
  return result.status === 'complete' ? 0 : 1
}
