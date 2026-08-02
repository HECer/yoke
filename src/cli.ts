#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { realpathSync } from 'node:fs'
import { validateCanon } from './canon/validate.js'
import type { Agent, DecisionPolicy } from './retrofit/config.js'
import { runRetrofit } from './retrofit/command.js'
import { setLoopEnabled, loopStatus, runLoopCommand } from './loop/run-command.js'
import { runContextInit, runContextStatus } from './context/command.js'
import { runReview } from './review/command.js'
import { scanDir } from './scan/design.js'
import { runNew } from './new/command.js'
import { runPrdDraft, runPrdCheck } from './prd/command.js'
import { runLoopCleanup } from './loop/cleanup.js'
import { runFlowSmoke } from './smoke/command.js'
import { maybeNotifyUpdate, currentYokeVersion } from './update/check.js'
import { runUpgrade } from './update/upgrade.js'
import { printAudit, runAudit } from './audit/command.js'
import { runSetup } from './setup/command.js'
import {
  answerPendingDecision, answeredDecisionResumeIsValid, clearDecisionResume, decisionProcessingExists, decisionResumeMatchesCurrent,
  finalizeCommittedDecisionResume,
  formatPendingDecision, readDecisionResume, readPendingDecision, writeDecisionResume,
} from './loop/decision.js'

export { runRetrofit } from './retrofit/command.js'

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

export function main(argv: string[]): number | Promise<number> {
  const [cmd, ...rest] = argv
  switch (cmd) {
    case 'setup': {
      const targetDir = rest.find(a => !a.startsWith('-')) ?? '.'
      const valid: Agent[] = ['claude', 'codex', 'gemini']
      const hostArg = rest.find(a => a.startsWith('--host='))?.slice('--host='.length)
      if (hostArg && !valid.includes(hostArg as Agent)) { console.error(`Invalid --host value: ${hostArg}`); return 1 }
      const agentArg = rest.find(a => a.startsWith('--agent='))?.slice('--agent='.length)
      const agentTokens = agentArg === 'all' ? valid : agentArg?.split(',').map(a => a.trim())
      const invalidAgents = agentTokens?.filter(a => !valid.includes(a as Agent)) ?? []
      if (agentArg && (invalidAgents.length > 0 || agentTokens?.length === 0)) {
        console.error(`Invalid --agent value: ${agentArg} (expected claude,codex,gemini|all)`)
        return 1
      }
      const agents = agentTokens ? [...new Set(agentTokens as Agent[])] : undefined
      const runnerArg = rest.find(a => a.startsWith('--runner='))?.slice('--runner='.length)
      if (runnerArg && !valid.includes(runnerArg as Agent)) { console.error(`Invalid --runner value: ${runnerArg}`); return 1 }
      const graphArg = rest.find(a => a.startsWith('--code-graph='))?.slice('--code-graph='.length)
      if (graphArg && graphArg !== 'graphify' && graphArg !== 'serena') { console.error(`Invalid --code-graph value: ${graphArg}`); return 1 }
      const policyArg = rest.find(a => a.startsWith('--decision-policy='))?.slice('--decision-policy='.length)
      if (policyArg && policyArg !== 'auto' && policyArg !== 'critical') { console.error(`Invalid --decision-policy value: ${policyArg}`); return 1 }
      const loop = rest.includes('--loop') ? true : rest.includes('--no-loop') ? false : undefined
      const routing = rest.includes('--routing') ? true : rest.includes('--no-routing') ? false : undefined
      return runSetup(targetDir, {
        host: hostArg as Agent | undefined, agents, runner: runnerArg as Agent | undefined,
        codeGraph: graphArg as 'graphify' | 'serena' | undefined,
        loop, routing, decisionPolicy: policyArg as DecisionPolicy | undefined,
        interactive: rest.includes('--yes') ? false : undefined,
      })
    }
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
      if (sub === 'cleanup') return runLoopCleanup(targetDir, {
        removeWorktrees: rest.includes('--remove-worktrees'),
        discardStaleRecovery: rest.includes('--discard-stale-recovery'),
      })
      if (sub === 'decision') { console.log(formatPendingDecision(targetDir)); return 0 }
      if (sub === 'resume') {
        if (rest.includes('--discard')) {
          try { clearDecisionResume(targetDir) } catch (error) {
            console.error(`Could not discard trusted decision resume state: ${(error as Error).message}`)
            return 1
          }
          console.log('Discarded the trusted decision resume state. Pending decisions, if any, were kept.')
          return 0
        }
        let resume
        try { resume = readDecisionResume(targetDir) } catch (error) {
          console.error(`Invalid trusted decision resume state: ${(error as Error).message}`)
          return 1
        }
        if (resume && !resume.answered && !readPendingDecision(targetDir) && !decisionProcessingExists(targetDir)) {
          try { resume = finalizeCommittedDecisionResume(targetDir, resume) } catch (error) {
            console.error(`Could not recover committed decision resume state: ${(error as Error).message}`)
            return 1
          }
        }
        if (!resume?.answered) { console.error('No answered critical decision is ready to resume.'); return 1 }
        if (readPendingDecision(targetDir) || decisionProcessingExists(targetDir)) {
          console.error('The critical decision is not fully answered yet. Use yoke loop answer first.')
          return 1
        }
        if (!answeredDecisionResumeIsValid(targetDir, resume)) {
          console.error('The answered decision is not committed on the current project/branch or the PRD changed; refusing a stale resume.')
          return 1
        }
        const { version: _version, storyId: _storyId, requestId: _requestId, answered: _answered, ...resumeOptions } = resume
        return runLoopCommand(targetDir, resumeOptions)
      }
      if (sub === 'answer') {
        const choice = rest.find(a => a.startsWith('--choice='))?.slice('--choice='.length)
        if (!choice) { console.error('usage: yoke loop answer [dir] --choice=<id|label> [--rationale="..."] [--no-resume]'); return 1 }
        const rationale = rest.find(a => a.startsWith('--rationale='))?.slice('--rationale='.length)
        let resume = null
        if (!rest.includes('--no-resume')) {
          try { resume = readDecisionResume(targetDir) } catch (error) {
            console.error(`Invalid trusted decision resume state: ${(error as Error).message}`)
            return 1
          }
          if (!resume) {
            console.error('No trusted resume state matches this decision. Re-run with --no-resume to record the answer without restarting the loop.')
            return 1
          }
          try {
            if (!decisionResumeMatchesCurrent(targetDir, resume)) {
              console.error('Trusted resume state does not match the current pending decision; refusing to restart with stale options.')
              return 1
            }
          } catch (error) {
            console.error(`Could not validate trusted resume state: ${(error as Error).message}`)
            return 1
          }
        }
        const answered = answerPendingDecision(targetDir, {
          choice,
          rationale,
          onCommitted: resume
            ? (requestId, answerId) => writeDecisionResume(targetDir, { ...resume!, requestId, answered: true, answerId })
            : undefined,
        })
        if (answered !== 0) return answered
        if (rest.includes('--no-resume')) {
          try { clearDecisionResume(targetDir) } catch (error) {
            console.error(`Decision was recorded, but trusted resume state could not be cleared: ${(error as Error).message}`)
            return 1
          }
          return 0
        }
        const answeredResume = readDecisionResume(targetDir)
        if (!answeredResume || !answeredDecisionResumeIsValid(targetDir, answeredResume)) {
          console.error('Decision was recorded, but its commit could not be bound to the trusted resume state. Use yoke loop resume after resolving this state.')
          return 1
        }
        const { version: _version, storyId: _storyId, requestId: _requestId, answered: _answered, ...resumeOptions } = resume!
        return runLoopCommand(targetDir, resumeOptions)
      }
      if (sub === 'run') {
        try {
          if (readDecisionResume(targetDir)) {
            console.error('A prior critical decision has preserved run options. Finish it with yoke loop answer/resume, or explicitly clear the private resume state with yoke loop resume --discard.')
            return 1
          }
        } catch (error) {
          console.error(`Invalid trusted decision resume state: ${(error as Error).message}`)
          return 1
        }
        const maxArg = rest.find(a => a.startsWith('--max='))
        const rawMax = maxArg ? Number(maxArg.slice('--max='.length)) : undefined
        if (rawMax !== undefined && (!Number.isInteger(rawMax) || rawMax <= 0)) {
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
        const allowSelfReview = rest.includes('--allow-self-review')
        const permissions = rest.includes('--unsafe') ? 'unsafe' as const : undefined
        const parallelArg = rest.find(a => a.startsWith('--parallel='))
        const parallel = parallelArg ? Number(parallelArg.slice('--parallel='.length)) : 1
        if (!Number.isInteger(parallel) || parallel < 1) { console.error(`Invalid --parallel value: ${parallelArg}`); return 1 }
        const json = rest.includes('--json')
        const routing = rest.includes('--routing') ? true : rest.includes('--no-routing') ? false : undefined
        const toArg = rest.find(a => a.startsWith('--timeout='))
        let timeoutMinutes: number | undefined
        if (toArg) {
          const v = Number(toArg.slice('--timeout='.length))
          if (!Number.isFinite(v) || v < 0) { console.error(`Invalid --timeout value: ${toArg}`); return 1 }
          timeoutMinutes = v
        }
        const oaArg = rest.find(a => a.startsWith('--on-ambiguity='))?.slice('--on-ambiguity='.length)
        if (oaArg && oaArg !== 'resolve' && oaArg !== 'abort') {
          console.error(`Invalid --on-ambiguity value: ${oaArg} (expected resolve|abort)`)
          return 1
        }
        const dpArg = rest.find(a => a.startsWith('--decision-policy='))?.slice('--decision-policy='.length)
        if (dpArg && dpArg !== 'auto' && dpArg !== 'critical') {
          console.error(`Invalid --decision-policy value: ${dpArg} (expected auto|critical)`)
          return 1
        }
        return runLoopCommand(targetDir, { maxIterations: rawMax, agent, isolate, parallel, reviewer, review, allowSelfReview, timeoutMinutes, json, routing, onAmbiguity: oaArg as 'resolve' | 'abort' | undefined, decisionPolicy: dpArg as DecisionPolicy | undefined, permissions })
      }
      console.log('usage: yoke loop <on|off|status|decision|answer|resume [--discard]|cleanup [--remove-worktrees] [--discard-stale-recovery]|run [--max=N] [--parallel=N] [--runner=<claude|codex|gemini>] [--reviewer=<claude|codex|gemini>] [--review] [--allow-self-review] [--routing|--no-routing] [--isolate] [--unsafe] [--timeout=<minutes>] [--decision-policy=<auto|critical>] [--json]> [targetDir]')
      return 1
    }
    case 'new': {
      const dir = rest.find(a => !a.startsWith('-'))
      if (!dir) {
        console.error('usage: yoke new <dir> [--idea="..."] [--agent=claude,codex,gemini|all] [--runner=<claude|codex|gemini>] [--loop]')
        return 1
      }
      const idea = rest.find(a => a.startsWith('--idea='))?.slice('--idea='.length)
      const loop = rest.includes('--loop')
      const agentArg = rest.find(a => a.startsWith('--agent='))?.slice('--agent='.length)
      const all: Agent[] = ['claude', 'codex', 'gemini']
      const agents = !agentArg || agentArg === 'all'
        ? (agentArg === 'all' ? all : undefined)
        : agentArg.split(',').filter((a): a is Agent => (all as string[]).includes(a))
      if (agentArg && agentArg !== 'all' && agents !== undefined && agents.length === 0) {
        console.warn('Unknown agent(s) in --agent; falling back to detection')
      }
      const runnerArg = rest.find(a => a.startsWith('--runner='))?.slice('--runner='.length)
      if (runnerArg && !(all as string[]).includes(runnerArg)) {
        console.error(`Invalid --runner value: ${runnerArg} (expected claude|codex|gemini)`)
        return 1
      }
      return runNew(dir, { idea, agents, runner: runnerArg as Agent | undefined, loop })
    }
    case 'prd': {
      const sub = rest[0]
      const targetDir = rest.slice(1).find(a => !a.startsWith('-')) ?? '.'
      if (sub === 'draft') {
        const idea = rest.find(a => a.startsWith('--idea='))?.slice('--idea='.length)
        if (!idea) {
          console.error('usage: yoke prd draft [dir] --idea="..." [--runner=<claude|codex|gemini>] [--force] [--timeout=<minutes>]')
          return 1
        }
        const valid = ['claude', 'codex', 'gemini']
        const runnerArg = rest.find(a => a.startsWith('--runner='))?.slice('--runner='.length)
        if (runnerArg && !valid.includes(runnerArg)) {
          console.error(`Invalid --runner value: ${runnerArg} (expected claude|codex|gemini)`)
          return 1
        }
        const force = rest.includes('--force')
        const toArg = rest.find(a => a.startsWith('--timeout='))
        let timeoutMinutes: number | undefined
        if (toArg) {
          const v = Number(toArg.slice('--timeout='.length))
          if (!Number.isFinite(v) || v < 0) { console.error(`Invalid --timeout value: ${toArg}`); return 1 }
          timeoutMinutes = v
        }
        return runPrdDraft(targetDir, { idea, runner: runnerArg as Agent | undefined, force, timeoutMinutes })
      }
      if (sub === 'check') return runPrdCheck(targetDir)
      console.log('usage: yoke prd <draft|check> [dir] [--idea="..."] [--runner=<claude|codex|gemini>] [--force] [--timeout=<minutes>]')
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
      const allowSelfReview = rest.includes('--allow-self-review')
      const json = rest.includes('--json')
      const toArg = rest.find(a => a.startsWith('--timeout='))
      let timeoutMinutes: number | undefined
      if (toArg) {
        const v = Number(toArg.slice('--timeout='.length))
        if (!Number.isFinite(v) || v < 0) { console.error(`Invalid --timeout value: ${toArg}`); return 1 }
        timeoutMinutes = v
      }
      return runReview(targetDir, { reviewer: reviewerArg as Agent | undefined, base, focus, allowSelfReview, json, timeoutMinutes })
    }
    case 'audit': {
      const targetDir = rest.find(a => !a.startsWith('-')) ?? '.'
      const json = rest.includes('--json')
      const result = runAudit(targetDir)
      printAudit(result, json)
      return result.code
    }
    case 'flow-smoke': {
      const targetDir = rest.find(a => !a.startsWith('-')) ?? '.'
      const url = rest.find(a => a.startsWith('--url='))?.slice('--url='.length)
      const label = rest.find(a => a.startsWith('--label='))?.slice('--label='.length)
      return runFlowSmoke(targetDir, { url, label })
    }
    case 'design-scan': {
      const targetDir = rest.find(a => !a.startsWith('-')) ?? '.'
      const report = rest.includes('--report')
      const maxArg = rest.find(a => a.startsWith('--max='))
      const max = maxArg ? Number(maxArg.slice('--max='.length)) : 4
      if (!Number.isFinite(max) || max < 0) { console.error(`Invalid --max value: ${maxArg}`); return 1 }
      return runDesignScan(targetDir, { max, report })
    }
    case 'upgrade':
      return runUpgrade()
    default:
      console.log('usage: yoke <setup [dir] | new <dir> [--idea="..."] | validate [canonDir] | retrofit [targetDir] [--agent=claude,codex,gemini|all] [--code-graph=graphify|serena] [--loop] | prd <draft|check> [dir] | loop <on|off|status|decision|answer|resume|run|cleanup> | context <init|status> | review [dir] [--reviewer=<claude|codex|gemini>] [--base=<ref>] [--focus="..."] | design-scan [dir] [--max=N] [--report] | flow-smoke [dir] [--url=<baseUrl>] [--label=<name>] | upgrade>')
      return cmd ? 1 : 0
  }
}

// Is this module the process entry point? Node realpaths the ESM entry for
// import.meta.url but argv[1] keeps the path as typed — a globally npm-installed
// CLI reaches this file THROUGH the node_modules/yoke symlink, so argv[1] must be
// realpathed before comparing or the global binary silently exits without running.
export function isMainEntry(argv1: string | undefined, moduleUrl: string): boolean {
  if (!argv1) return false
  let resolved = argv1
  try { resolved = realpathSync(argv1) } catch { /* nonexistent path — compare as given */ }
  return pathToFileURL(resolved).href === moduleUrl
}

if (isMainEntry(process.argv[1], import.meta.url)) {
  const code = await main(process.argv.slice(2))
  // Non-blocking version hint (npm/gh-style): reads a cache, maybe spawns a
  // detached refresher. Never allowed to affect the command's outcome.
  try { maybeNotifyUpdate(currentYokeVersion()) } catch { /* never fatal */ }
  process.exit(code)
}
