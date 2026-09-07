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
  routingStrategy?: import('../retrofit/config.js').RoutingStrategy
  routingPreset?: boolean
  interactive?: boolean
  ask?: (question: string) => Promise<string>
}

const ALL_AGENTS: Agent[] = ['claude', 'codex', 'gemini', 'qwen']

export function defaultRoutingWorkers(agents: Agent[]): RoutingWorker[] {
  const workers: Record<Agent, RoutingWorker[]> = {
    claude: [
      { id: 'claude-fast', agent: 'claude', model: 'haiku', tier: 'light', costTier: 'low', capabilities: ['mechanical', 'tests'] },
      { id: 'claude-standard', agent: 'claude', model: 'sonnet', tier: 'standard', costTier: 'medium', capabilities: ['implementation'] },
      { id: 'claude-strong', agent: 'claude', model: 'sonnet', reasoningEffort: 'high', tier: 'strong', costTier: 'medium', capabilities: ['debugging'] },
      { id: 'claude-frontier', agent: 'claude', model: 'opus', tier: 'frontier', costTier: 'high', capabilities: ['architecture'] },
    ],
    codex: [
      { id: 'codex-light', agent: 'codex', model: 'gpt-5.6-luna', reasoningEffort: 'low', tier: 'light', costTier: 'low', capabilities: ['mechanical', 'tests'] },
      { id: 'codex-standard', agent: 'codex', model: 'gpt-5.6-terra', reasoningEffort: 'medium', tier: 'standard', costTier: 'low', capabilities: ['implementation'] },
      { id: 'codex-strong', agent: 'codex', model: 'gpt-5.6-sol', reasoningEffort: 'high', tier: 'strong', costTier: 'medium', capabilities: ['debugging'] },
      { id: 'codex-frontier', agent: 'codex', model: 'gpt-6-astra', reasoningEffort: 'high', tier: 'frontier', costTier: 'high', capabilities: ['architecture'] },
    ],
    gemini: [
      { id: 'gemini-light', agent: 'gemini', model: 'gemini-2.5-flash', tier: 'light', costTier: 'low', capabilities: ['mechanical', 'tests'] },
      { id: 'gemini-standard', agent: 'gemini', model: 'gemini-2.5-pro', tier: 'standard', costTier: 'medium', capabilities: ['implementation'] },
      { id: 'gemini-strong', agent: 'gemini', model: 'gemini-2.5-pro', tier: 'strong', costTier: 'medium', capabilities: ['debugging'] },
      { id: 'gemini-frontier', agent: 'gemini', model: 'gemini-2.5-pro', tier: 'frontier', costTier: 'high', capabilities: ['architecture'] },
    ],
    qwen: [
      { id: 'qwen-light', agent: 'qwen', model: 'qwen-turbo-latest', tier: 'light', costTier: 'low', capabilities: ['mechanical', 'tests'] },
      { id: 'qwen-standard', agent: 'qwen', model: 'qwen3-coder-plus', tier: 'standard', costTier: 'medium', capabilities: ['implementation'] },
      { id: 'qwen-strong', agent: 'qwen', model: 'qwen3-coder-plus', tier: 'strong', costTier: 'medium', capabilities: ['debugging'] },
      { id: 'qwen-frontier', agent: 'qwen', model: 'qwen3-235b-a22b', tier: 'frontier', costTier: 'high', capabilities: ['architecture'] },
    ],
  }
  return agents.flatMap(agent => workers[agent])
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
  const defaultRouting = opts.routing ?? existing?.routing?.enabled ?? true
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
      agents = parseAgents(await ask(`Agents [${defaultAgents.join(',')}] (claude,codex,gemini,qwen|all): `), defaultAgents)
      const graphAnswer = (await ask(`Code graph [${defaultGraph}] (graphify|serena): `)).trim().toLowerCase()
      if (graphAnswer === 'graphify' || graphAnswer === 'serena') codeGraph = graphAnswer
      loop = yes(await ask(`Enable autonomous loop? [${defaultLoop ? 'yes' : 'no'}]: `), defaultLoop)
      const runnerAnswer = (await ask(`Default runner [${runner}] (claude|codex|gemini|qwen): `)).trim().toLowerCase()
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
    config.loop = { parallel: 'auto', isolate: true, ...config.loop, enabled: loop, decisionPolicy }
    config.runner = { ...config.runner, agent: runner }
    const existingWorkers = config.routing?.workers ?? []
    config.routing = {
      ...config.routing,
      enabled: routing,
      strategy: opts.routingStrategy ?? config.routing?.strategy ?? 'capability',
      maxCandidates: config.routing?.maxCandidates ?? 3,
      assessmentPolicy: existing?.routing?.assessmentPolicy ?? (existing ? 'on-demand' : 'prepared'),
      fallback: existing?.routing?.fallback ?? (existing ? 'parent' : 'block'),
      ...(config.routing?.orchestrator ? { orchestrator: config.routing.orchestrator } : {}),
      workers: existingWorkers.length > 0 && !opts.routingPreset ? existingWorkers : defaultRoutingWorkers(agents),
    }
    saveConfig(targetDir, config)
    console.log(`Yoke setup complete: agents=${agents.join(',')} · runner=${runner} · loop=${loop ? 'on' : 'off'} · routing=${routing ? 'on' : 'off'} · decisions=${decisionPolicy}`)
    return 0
  } finally {
    close?.()
  }
}
