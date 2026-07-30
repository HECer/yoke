import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { detectHostAgent } from '../agents/host.js'
import { loadConfig, saveConfig, type Agent, type CodeGraph, type DecisionPolicy } from '../retrofit/config.js'
import { detectProject } from '../retrofit/detect.js'
import { runRetrofit } from '../retrofit/command.js'

export interface SetupOptions {
  host?: Agent
  agents?: Agent[]
  codeGraph?: CodeGraph
  loop?: boolean
  runner?: Agent
  decisionPolicy?: DecisionPolicy
  interactive?: boolean
  ask?: (question: string) => Promise<string>
}

const ALL_AGENTS: Agent[] = ['claude', 'codex', 'gemini']

function parseAgents(value: string, fallback: Agent[]): Agent[] {
  if (value.trim().toLowerCase() === 'all') return [...ALL_AGENTS]
  const parsed = value.split(',').map(v => v.trim().toLowerCase()).filter((v): v is Agent => ALL_AGENTS.includes(v as Agent))
  return parsed.length > 0 ? [...new Set(parsed)] : fallback
}

function yes(value: string, fallback: boolean): boolean {
  const normalized = value.trim().toLowerCase()
  if (['y', 'yes', 'j', 'ja', 'true', '1'].includes(normalized)) return true
  if (['n', 'no', 'nein', 'false', '0'].includes(normalized)) return false
  return fallback
}

export async function runSetup(targetDir: string, opts: SetupOptions = {}): Promise<number> {
  const existing = loadConfig(targetDir)
  const detected = detectProject(targetDir)
  const host = opts.host ?? detectHostAgent()
  const configuredAgents = existing?.agents.filter(a => ALL_AGENTS.includes(a)) ?? []
  const defaultAgents = opts.agents && opts.agents.length > 0
    ? opts.agents
    : configuredAgents.length > 0
      ? configuredAgents
      : detected.agents.length > 0
        ? detected.agents
        : [host ?? 'claude']
  const defaultGraph = opts.codeGraph ?? existing?.codeGraph ?? 'graphify'
  const defaultLoop = opts.loop ?? existing?.loop.enabled ?? true
  const defaultRunner = opts.runner ?? existing?.runner?.agent ?? (host && defaultAgents.includes(host) ? host : defaultAgents[0] ?? host ?? 'claude')
  const defaultPolicy = opts.decisionPolicy ?? existing?.loop.decisionPolicy ?? (existing?.loop.onAmbiguity === 'abort' ? 'critical' : 'auto')
  const interactive = opts.interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true)

  let close: (() => void) | undefined
  let ask = opts.ask
  if (interactive && !ask) {
    const rl = createInterface({ input, output })
    ask = (question) => rl.question(question)
    close = () => rl.close()
  }

  try {
    let agents = defaultAgents
    let codeGraph = defaultGraph
    let loop = defaultLoop
    let runner = defaultRunner
    let decisionPolicy = defaultPolicy
    if (interactive && ask) {
      agents = parseAgents(await ask(`Agents [${defaultAgents.join(',')}] (claude,codex,gemini|all): `), defaultAgents)
      const graphAnswer = (await ask(`Code graph [${defaultGraph}] (graphify|serena): `)).trim().toLowerCase()
      if (graphAnswer === 'graphify' || graphAnswer === 'serena') codeGraph = graphAnswer
      loop = yes(await ask(`Enable autonomous loop? [${defaultLoop ? 'yes' : 'no'}]: `), defaultLoop)
      const runnerAnswer = (await ask(`Default runner [${runner}] (claude|codex|gemini): `)).trim().toLowerCase()
      if (ALL_AGENTS.includes(runnerAnswer as Agent)) runner = runnerAnswer as Agent
      const policyAnswer = (await ask(`Decision mode [${decisionPolicy}] (auto|critical): `)).trim().toLowerCase()
      if (policyAnswer === 'auto' || policyAnswer === 'critical') decisionPolicy = policyAnswer
    }

    if (!agents.includes(runner)) agents = [...agents, runner]
    const code = runRetrofit(targetDir, { loop, agents, codeGraph, host })
    if (code !== 0) return code
    const config = loadConfig(targetDir)
    if (!config) return 1
    config.loop = { ...config.loop, enabled: loop, decisionPolicy }
    config.runner = { ...config.runner, agent: runner }
    saveConfig(targetDir, config)
    console.log(`Yoke setup complete: agents=${agents.join(',')} · runner=${runner} · loop=${loop ? 'on' : 'off'} · decisions=${decisionPolicy}`)
    return 0
  } finally {
    close?.()
  }
}
