import { join } from 'node:path'
import { resolveCanonDir } from './canon-dir.js'
import { planRetrofit } from './plan.js'
import { applyActions } from './apply.js'
import { formatReport } from './report.js'
import { detectProject } from './detect.js'
import { ensureGitignore } from './gitignore.js'
import { loadConfig, saveConfig, defaultConfig, type Agent, type YokeConfig, type CodeGraph, type CodeIntelligenceMode } from './config.js'
import { loadManifest } from '../canon/manifest.js'
import { detectHostAgent } from '../agents/host.js'
import { pruneWorktrees } from '../loop/cleanup.js'

export interface RetrofitOptions {
  loop: boolean
  agents?: Agent[]
  codeGraph?: CodeGraph
  codeIntelligence?: CodeIntelligenceMode
  host?: Agent
  cleanWorktrees?: boolean
  runnerModel?: string
  runnerReasoning?: string
  agentModels?: Record<string, string>
  agentReasoning?: Record<string, string>
}

export function runRetrofit(targetDir: string, opts: RetrofitOptions): number {
  const canonDir = resolveCanonDir()
  const canonVersion = loadManifest(join(canonDir, 'manifest.yaml')).version

  if (opts.cleanWorktrees) {
    const pruneRes = pruneWorktrees(targetDir)
    if (pruneRes.removed.length > 0) {
      console.log(`Pruned ${pruneRes.removed.length} orphaned worktree(s).`)
    }
  }

  const detection = detectProject(targetDir)
  const agents: Agent[] = opts.agents && opts.agents.length > 0
    ? opts.agents
    : (detection.agents.length > 0 ? detection.agents : [opts.host ?? detectHostAgent() ?? 'claude'])

  const existing = loadConfig(targetDir)
  const codeGraph: CodeGraph = opts.codeGraph ?? existing?.codeGraph ?? 'graphify'
  const codeIntelligence: CodeIntelligenceMode = opts.codeIntelligence ?? existing?.codeIntelligence?.mode ?? 'off'

  const actions = planRetrofit(canonDir, targetDir, agents, codeGraph, codeIntelligence)
  const backupDir = join(targetDir, '.yoke', 'backup', String(Date.now()))
  const applied = applyActions(actions, targetDir, { backupDir })

  // Ensure runtime artifacts (loop status/log, worktrees, backups) are gitignored
  // so the loop's clean-tree pre-dispatch gate is not broken by untracked files.
  ensureGitignore(targetDir)

  const priorAgents = existing?.agents ?? []
  const mergedAgents = [...new Set([...priorAgents, ...agents])]

  const runnerConfig = { ...(existing?.runner ?? {}) }
  if (opts.runnerModel !== undefined) runnerConfig.model = opts.runnerModel
  if (opts.runnerReasoning !== undefined) runnerConfig.reasoningEffort = opts.runnerReasoning

  let updatedWorkers = existing?.routing?.workers
  if (updatedWorkers && (opts.agentModels || opts.agentReasoning)) {
    updatedWorkers = updatedWorkers.map(w => {
      const model = opts.agentModels?.[w.agent] ?? w.model
      const reasoningEffort = opts.agentReasoning?.[w.agent] ?? w.reasoningEffort
      return { ...w, ...(model ? { model } : {}), ...(reasoningEffort ? { reasoningEffort } : {}) }
    })
  }

  const config: YokeConfig = {
    ...(existing ?? defaultConfig(canonVersion)),
    canonVersion,
    agents: mergedAgents,
    loop: { ...existing?.loop, enabled: opts.loop },
    codeGraph,
    codeIntelligence: { ...(existing?.codeIntelligence ?? {}), mode: codeIntelligence },
    ...(Object.keys(runnerConfig).length > 0 ? { runner: runnerConfig } : {}),
    ...(existing?.routing && updatedWorkers ? { routing: { ...existing.routing, workers: updatedWorkers } } : {}),
    ...(existing?.design
      ? { design: existing.design }
      : detection.ui.detected ? { design: { mode: 'auto' as const, max: 4 } } : {}),
  }
  saveConfig(targetDir, config)

  console.log(formatReport(applied, { loopEnabled: config.loop.enabled, detectedAgents: detection.agents, ui: detection.ui }))
  return 0
}
