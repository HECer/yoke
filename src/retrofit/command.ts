import { join } from 'node:path'
import { resolveCanonDir } from './canon-dir.js'
import { planRetrofit } from './plan.js'
import { applyActions } from './apply.js'
import { formatReport } from './report.js'
import { detectProject } from './detect.js'
import { ensureGitignore } from './gitignore.js'
import { loadConfig, saveConfig, defaultConfig, type Agent, type YokeConfig, type CodeGraph } from './config.js'
import { loadManifest } from '../canon/manifest.js'

export function runRetrofit(targetDir: string, opts: { loop: boolean; agents?: Agent[]; codeGraph?: CodeGraph }): number {
  const canonDir = resolveCanonDir()
  const canonVersion = loadManifest(join(canonDir, 'manifest.yaml')).version

  const detection = detectProject(targetDir)
  const agents: Agent[] = opts.agents && opts.agents.length > 0
    ? opts.agents
    : (detection.agents.length > 0 ? detection.agents : ['claude'])

  const existing = loadConfig(targetDir)
  const codeGraph: CodeGraph = opts.codeGraph ?? existing?.codeGraph ?? 'graphify'

  const actions = planRetrofit(canonDir, targetDir, agents, codeGraph)
  const backupDir = join(targetDir, '.yoke', 'backup', String(Date.now()))
  const applied = applyActions(actions, targetDir, { backupDir })

  // Ensure runtime artifacts (loop status/log, worktrees, backups) are gitignored
  // so the loop's clean-tree pre-dispatch gate is not broken by untracked files.
  ensureGitignore(targetDir)

  const priorAgents = existing?.agents ?? []
  const mergedAgents = [...new Set([...priorAgents, ...agents])]
  const config: YokeConfig = {
    ...(existing ?? defaultConfig(canonVersion)),
    canonVersion,
    agents: mergedAgents,
    loop: { enabled: opts.loop },
    codeGraph,
  }
  saveConfig(targetDir, config)

  console.log(formatReport(applied, { loopEnabled: config.loop.enabled, detectedAgents: detection.agents }))
  return 0
}
