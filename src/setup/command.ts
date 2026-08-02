import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { detectHostAgent } from '../agents/host.js'
import { loadConfig, saveConfig, type Agent, type CodeGraph, type DecisionPolicy, type RoutingWorker } from '../retrofit/config.js'
import { detectProject } from '../retrofit/detect.js'
import { runRetrofit } from '../retrofit/command.js'

export interface SetupOptions {
  host?: Agent
  agents?: Agent[]
  codeGraph?: CodeGraph
  loop?: boolean
  runner?: Agent
  decisionPolicy?: DecisionPolicy
  routing?: boolean
  interactive?: boolean
  ask?: (question: string) => Promise<string>
}

const ALL_AGENTS: Agent[] = ['claude', 'codex', 'gemini']

export function defaultRoutingWorkers(agents: Agent[]): RoutingWorker[] {
  const workers: Partial<Record<Agent, RoutingWorker>> = {
    claude: { id: 'claude-fast', agent: 'claude', model: 'haiku', costTier: 'low', capabilities: ['exploration', 'mechanical-edits', 'tests'] },
    // Inherit the account's current Codex model and lower only its supported effort.
    // This avoids pinning a model id that will age out of the provider catalog.
    codex: { id: 'codex-light', agent: 'codex', reasoningEffort: 'low', costTier: 'medium', capabilities: ['exploration', 'mechanical-edits', 'tests'] },
    // Gemini CLI's default/Auto route tracks the models available to the active account.
    gemini: { id: 'gemini-auto', agent: 'gemini', costTier: 'low', capabilities: ['large-context', 'exploration', 'implementation'] },
  }
  return agents.map(agent => workers[agent]).filter((worker): worker is RoutingWorker => worker !== undefined)
}

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
  const defaultRouting = opts.routing ?? existing?.routing?.enabled ?? false
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
    let routing = defaultRouting
    if (interactive && ask) {
      agents = parseAgents(await ask(`Agents [${defaultAgents.join(',')}] (claude,codex,gemini|all): `), defaultAgents)
      const graphAnswer = (await ask(`Code graph [${defaultGraph}] (graphify|serena): `)).trim().toLowerCase()
      if (graphAnswer === 'graphify' || graphAnswer === 'serena') codeGraph = graphAnswer
      loop = yes(await ask(`Enable autonomous loop? [${defaultLoop ? 'yes' : 'no'}]: `), defaultLoop)
      const runnerAnswer = (await ask(`Default runner [${runner}] (claude|codex|gemini): `)).trim().toLowerCase()
      if (ALL_AGENTS.includes(runnerAnswer as Agent)) runner = runnerAnswer as Agent
      const policyAnswer = (await ask(`Decision mode [${decisionPolicy}] (auto|critical): `)).trim().toLowerCase()
      if (policyAnswer === 'auto' || policyAnswer === 'critical') decisionPolicy = policyAnswer
      routing = yes(await ask(`Enable adaptive multi-model routing? [${defaultRouting ? 'yes' : 'no'}]: `), defaultRouting)
    }

    if (!agents.includes(runner)) agents = [...agents, runner]
    const code = runRetrofit(targetDir, { loop, agents, codeGraph, host })
    if (code !== 0) return code
    const config = loadConfig(targetDir)
    if (!config) return 1
    config.loop = { ...config.loop, enabled: loop, decisionPolicy }
    config.runner = { ...config.runner, agent: runner }
    const existingWorkers = config.routing?.workers ?? []
    config.routing = {
      enabled: routing,
      strategy: config.routing?.strategy ?? 'balanced',
      maxCandidates: config.routing?.maxCandidates ?? 3,
      ...(config.routing?.orchestrator ? { orchestrator: config.routing.orchestrator } : {}),
      workers: existingWorkers.length > 0 ? existingWorkers : defaultRoutingWorkers(agents),
    }
    saveConfig(targetDir, config)
    console.log(`Yoke setup complete: agents=${agents.join(',')} · runner=${runner} · loop=${loop ? 'on' : 'off'} · routing=${routing ? 'on' : 'off'} · decisions=${decisionPolicy}`)
    return 0
  } finally {
    close?.()
  }
}
