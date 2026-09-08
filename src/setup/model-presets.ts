import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RoutingWorker } from '../retrofit/config.js'
import type { Action } from '../retrofit/plan.js'

export const MODEL_PROVIDERS = ['deepseek', 'kimi'] as const
export type ModelProvider = typeof MODEL_PROVIDERS[number]

interface ModelPreset {
  id: string
  workerId: string
  tier: NonNullable<RoutingWorker['tier']>
  costTier: RoutingWorker['costTier']
  contextWindowSize: number
}
const PRESETS: Record<ModelProvider, { baseUrl: string; envKey: string; models: ModelPreset[] }> = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1', envKey: 'DEEPSEEK_API_KEY',
    models: [
      { id: 'deepseek-v4-flash', workerId: 'deepseek-standard', tier: 'standard', costTier: 'low', contextWindowSize: 1_000_000 },
      { id: 'deepseek-v4-pro', workerId: 'deepseek-strong', tier: 'strong', costTier: 'medium', contextWindowSize: 1_000_000 },
    ],
  },
  kimi: {
    baseUrl: 'https://api.moonshot.ai/v1', envKey: 'MOONSHOT_API_KEY',
    models: [
      { id: 'kimi-k2.6', workerId: 'kimi-standard', tier: 'standard', costTier: 'medium', contextWindowSize: 262_144 },
      { id: 'kimi-k2.7-code', workerId: 'kimi-strong', tier: 'strong', costTier: 'medium', contextWindowSize: 262_144 },
      { id: 'kimi-k3', workerId: 'kimi-frontier', tier: 'frontier', costTier: 'high', contextWindowSize: 1_000_000 },
    ],
  },
}

export function modelPresetWorkers(providers: ModelProvider[]): RoutingWorker[] {
  return [...new Set(providers)].flatMap(provider => PRESETS[provider].models.map(model => ({
    id: model.workerId, agent: 'qwen' as const, model: `openai::${model.id}`, tier: model.tier,
    costTier: model.costTier, capabilities: ['implementation'],
  })))
}

/** Explicit opt-in only. Keep user routes intact; new entries contain only environment key references. */
export function planModelPresets(targetDir: string, providers: ModelProvider[]): Action[] {
  if (!providers.length) return []
  const file = join(targetDir, '.qwen/settings.json')
  const settings = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw Error('Qwen settings must be an object')
  if (settings.modelProviders !== undefined && (!settings.modelProviders || typeof settings.modelProviders !== 'object' || Array.isArray(settings.modelProviders))) throw Error('Qwen modelProviders must be an object')
  const existing = settings.modelProviders?.openai ?? []
  if (!Array.isArray(existing) || existing.some(model => !model || typeof model.id !== 'string')) throw Error('Qwen modelProviders.openai must be an array of models with ids')
  const entries = [...new Set(providers)].flatMap(provider => {
    const preset = PRESETS[provider]
    return preset.models.filter(model => !existing.some(entry => entry.id === model.id)).map(model => ({
      id: model.id, baseUrl: preset.baseUrl, envKey: preset.envKey,
      generationConfig: { contextWindowSize: model.contextWindowSize },
    }))
  })
  return [{ kind: 'write', target: '.qwen/settings.json', merge: true, content: JSON.stringify({ modelProviders: { openai: entries } }, null, 2) + '\n', reason: 'explicit DeepSeek/Kimi API model presets (environment key references only)' }]
}
