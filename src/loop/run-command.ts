import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { loadConfig, saveConfig, defaultConfig } from '../retrofit/config.js'
import { loadPrd, progress } from './prd.js'
import { runLoop } from './loop.js'
import { realGitOps } from './git.js'
import { claudeRunner, type AgentRunner } from './runner.js'
import type { GitOps } from './gates.js'

export function prdPath(targetDir: string): string {
  return join(targetDir, '.forge', 'prd.yaml')
}

export function setLoopEnabled(targetDir: string, enabled: boolean): void {
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
  const result = runLoop({
    prdPath: path,
    targetDir,
    runner: opts.runner ?? claudeRunner,
    git: opts.git ?? realGitOps,
    maxIterations: opts.maxIterations,
  })
  console.log(`Loop ${result.status} after ${result.iterations} iteration(s): ${result.finalProgress.passed}/${result.finalProgress.total} stories pass`)
  if (result.reason) console.log(`Reason: ${result.reason}`)
  return result.status === 'complete' ? 0 : 1
}
