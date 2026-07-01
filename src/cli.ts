#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { validateCanon } from './canon/validate.js'
import { resolveCanonDir } from './retrofit/canon-dir.js'
import { planRetrofit } from './retrofit/plan.js'
import type { Agent } from './retrofit/config.js'
import { applyActions } from './retrofit/apply.js'
import { formatReport } from './retrofit/report.js'
import { detectProject } from './retrofit/detect.js'
import { ensureGitignore } from './retrofit/gitignore.js'
import { loadConfig, saveConfig, defaultConfig, type YokeConfig, type CodeGraph } from './retrofit/config.js'
import { loadManifest } from './canon/manifest.js'
import { join } from 'node:path'
import { setLoopEnabled, loopStatus, runLoopCommand } from './loop/run-command.js'
import { runContextInit, runContextStatus } from './context/command.js'
import { runReview } from './review/command.js'
import { scanDir } from './scan/design.js'

export function runValidate(canonDir: string): number {
  const issues = validateCanon(canonDir)
  for (const i of issues) {
    const line = `${i.level === 'error' ? 'ERROR' : 'warn '} ${i.message}`
    if (i.level === 'error') console.error(line)
    else console.log(line)
  }
  const errors = issues.filter(i => i.level === 'error')
  if (errors.length === 0) {
    console.log(`✓ canon valid (${canonDir})`)
    return 0
  }
  console.log(`✗ ${errors.length} error(s)`)
  return 1
}

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

export function runDesignScan(targetDir: string, opts: { max: number; report: boolean }): number {
  const { findings, score } = scanDir(targetDir)
  for (const f of findings) {
    console.log(`  ${f.file}:${f.line}  ${f.tell}  — ${f.hint}`)
  }
  const label = `Design scan: score ${score} (${findings.length} tell${findings.length === 1 ? '' : 's'}), budget ${opts.max}`
  if (opts.report) { console.log(`${label} — report only`); return 0 }
  if (score > opts.max) { console.log(`${label} — ✗ over budget`); return 1 }
  console.log(`${label} — ✓`)
  return 0
}

function main(argv: string[]): number {
  const [cmd, ...rest] = argv
  switch (cmd) {
    case 'validate':
      return runValidate(rest[0] ?? 'canon')
    case 'retrofit': {
      const targetDir = rest.find(a => !a.startsWith('-')) ?? '.'
      const loop = rest.includes('--loop')
      const agentArg = rest.find(a => a.startsWith('--agent='))?.slice('--agent='.length)
      const all: Agent[] = ['claude', 'codex', 'gemini']
      const agents = !agentArg || agentArg === 'all'
        ? (agentArg === 'all' ? all : undefined)
        : agentArg.split(',').filter((a): a is Agent => (all as string[]).includes(a))
      if (agentArg && agentArg !== 'all' && agents !== undefined && agents.length === 0) {
        console.warn('Unknown agent(s) in --agent; falling back to detection')
      }
      const cgArg = rest.find(a => a.startsWith('--code-graph='))?.slice('--code-graph='.length)
      const codeGraph = cgArg === 'serena' || cgArg === 'graphify' ? cgArg : undefined
      if (cgArg && !codeGraph) {
        console.error(`Invalid --code-graph value: ${cgArg} (expected graphify|serena)`)
        return 1
      }
      return runRetrofit(targetDir, { loop, agents, codeGraph })
    }
    case 'loop': {
      const sub = rest[0]
      const targetDir = rest.slice(1).find(a => !a.startsWith('-')) ?? '.'
      if (sub === 'on') { setLoopEnabled(targetDir, true); console.log('Loop enabled.'); return 0 }
      if (sub === 'off') { setLoopEnabled(targetDir, false); console.log('Loop disabled.'); return 0 }
      if (sub === 'status') { console.log(loopStatus(targetDir)); return 0 }
      if (sub === 'run') {
        const maxArg = rest.find(a => a.startsWith('--max='))
        const rawMax = maxArg ? Number(maxArg.slice('--max='.length)) : 25
        if (!Number.isFinite(rawMax) || rawMax <= 0) {
          console.error(`Invalid --max value: ${maxArg}`)
          return 1
        }
        const runnerArg = rest.find(a => a.startsWith('--runner='))?.slice('--runner='.length)
        const valid = ['claude', 'codex', 'gemini']
        const agent = runnerArg && valid.includes(runnerArg) ? (runnerArg as Agent) : undefined
        if (runnerArg && !agent) {
          console.error(`Invalid --runner value: ${runnerArg} (expected claude|codex|gemini)`)
          return 1
        }
        const isolate = rest.includes('--isolate')
        const reviewerArg = rest.find(a => a.startsWith('--reviewer='))?.slice('--reviewer='.length)
        let reviewer: Agent | undefined
        if (reviewerArg) {
          if (!valid.includes(reviewerArg)) {
            console.error(`Invalid --reviewer value: ${reviewerArg} (expected claude|codex|gemini)`)
            return 1
          }
          reviewer = reviewerArg as Agent
        }
        const review = rest.includes('--review')
        const toArg = rest.find(a => a.startsWith('--timeout='))
        let timeoutMinutes: number | undefined
        if (toArg) {
          const v = Number(toArg.slice('--timeout='.length))
          if (!Number.isFinite(v) || v < 0) { console.error(`Invalid --timeout value: ${toArg}`); return 1 }
          timeoutMinutes = v
        }
        return runLoopCommand(targetDir, { maxIterations: rawMax, agent, isolate, reviewer, review, timeoutMinutes })
      }
      console.log('usage: yoke loop <on|off|status|run [--max=N] [--runner=<claude|codex|gemini>] [--reviewer=<claude|codex|gemini>] [--review] [--isolate] [--timeout=<minutes>]> [targetDir]')
      return 1
    }
    case 'context': {
      const sub = rest[0]
      const targetDir = rest.slice(1).find(a => !a.startsWith('-')) ?? '.'
      if (sub === 'init') return runContextInit(targetDir)
      if (sub === 'status') return runContextStatus(targetDir)
      console.log('usage: yoke context <init|status> [targetDir]')
      return 1
    }
    case 'review': {
      const targetDir = rest.find(a => !a.startsWith('-')) ?? '.'
      const valid = ['claude', 'codex', 'gemini']
      const reviewerArg = rest.find(a => a.startsWith('--reviewer='))?.slice('--reviewer='.length)
      if (reviewerArg && !valid.includes(reviewerArg)) {
        console.error(`Invalid --reviewer value: ${reviewerArg} (expected claude|codex|gemini)`)
        return 1
      }
      const base = rest.find(a => a.startsWith('--base='))?.slice('--base='.length)
      const focus = rest.find(a => a.startsWith('--focus='))?.slice('--focus='.length)
      const toArg = rest.find(a => a.startsWith('--timeout='))
      let timeoutMinutes: number | undefined
      if (toArg) {
        const v = Number(toArg.slice('--timeout='.length))
        if (!Number.isFinite(v) || v < 0) { console.error(`Invalid --timeout value: ${toArg}`); return 1 }
        timeoutMinutes = v
      }
      return runReview(targetDir, { reviewer: reviewerArg as any, base, focus, timeoutMinutes })
    }
    case 'design-scan': {
      const targetDir = rest.find(a => !a.startsWith('-')) ?? '.'
      const report = rest.includes('--report')
      const maxArg = rest.find(a => a.startsWith('--max='))
      const max = maxArg ? Number(maxArg.slice('--max='.length)) : 4
      if (!Number.isFinite(max) || max < 0) { console.error(`Invalid --max value: ${maxArg}`); return 1 }
      return runDesignScan(targetDir, { max, report })
    }
    default:
      console.log('usage: yoke <validate [canonDir] | retrofit [targetDir] [--agent=claude,codex,gemini|all] [--code-graph=graphify|serena] [--loop] | loop <on|off|status|run> | context <init|status> | review [dir] [--reviewer=<claude|codex|gemini>] [--base=<ref>] [--focus="..."] | design-scan [dir] [--max=N] [--report]>')
      return cmd ? 1 : 0
  }
}

const isMain = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false
if (isMain) {
  process.exit(main(process.argv.slice(2)))
}
