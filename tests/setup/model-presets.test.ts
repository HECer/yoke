import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../../src/cli.js'
import { loadConfig, saveConfig } from '../../src/retrofit/config.js'
import { buildProviderInvocation } from '../../src/agents/providers.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-models-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })
const settings = () => JSON.parse(readFileSync(join(dir, '.qwen/settings.json'), 'utf8'))
describe('Open model presets through Qwen Code', () => {
  it('installs DeepSeek and Kimi endpoints with environment references and usable routing', async () => {
    expect(await main(['setup', dir, '--yes', '--model-provider=deepseek,kimi'])).toBe(0)
    const config = loadConfig(dir)!
    expect(config.agents).toContain('qwen')
    expect(config.runner).toMatchObject({ agent: 'qwen', model: 'openai::deepseek-v4-flash' })
    expect(config.routing!.workers.map(w => w.id)).toEqual(['deepseek-standard', 'deepseek-strong', 'kimi-standard', 'kimi-strong', 'kimi-frontier'])
    const entries = settings().modelProviders.openai
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'deepseek-v4-pro', baseUrl: 'https://api.deepseek.com/v1', envKey: 'DEEPSEEK_API_KEY' }),
      expect.objectContaining({ id: 'kimi-k3', baseUrl: 'https://api.moonshot.ai/v1', envKey: 'MOONSHOT_API_KEY' }),
    ]))
    expect(JSON.stringify(entries)).not.toContain('apiKey')
    for (const worker of config.routing!.workers) {
      const invocation = buildProviderInvocation('qwen', 'P', dir, 'safe', { model: worker.model, nativeMultiAgent: false })
      expect(invocation.command).toBe('qwen')
      expect(invocation.args).toContain('--auth-type')
      expect(invocation.args).toContain('openai')
      expect(invocation.args).toContain(worker.model!.split('::')[1])
      expect(invocation.args).not.toContain(worker.model)
    }
  })
  it('is idempotent and preserves existing credentials, endpoints, runner and custom workers', async () => {
    mkdirSync(join(dir, '.qwen'))
    const custom = { id: 'deepseek-v4-flash', baseUrl: 'https://my-gateway.example/v1', envKey: 'MY_DEEPSEEK_KEY', generationConfig: { maxTokens: 1234 } }
    writeFileSync(join(dir, '.qwen/settings.json'), JSON.stringify({ modelProviders: { openai: [custom] }, security: { auth: { selectedType: 'anthropic' } } }))
    const worker = { id: 'custom', agent: 'codex' as const, model: 'user-model', costTier: 'low' as const, capabilities: [] }
    saveConfig(dir, { canonVersion: 'test', agents: ['codex'], loop: { enabled: true }, runner: { agent: 'codex', model: 'user-model' }, routing: { enabled: true, strategy: 'balanced', maxCandidates: 3, workers: [worker] } })
    for (let i = 0; i < 2; i++) expect(await main(['setup', dir, '--yes', '--model-provider=deepseek'])).toBe(0)
    expect(settings().modelProviders.openai.filter((m: any) => m.id === custom.id)).toEqual([custom])
    expect(settings().security.auth.selectedType).toBe('anthropic')
    expect(loadConfig(dir)!.runner).toMatchObject({ agent: 'codex', model: 'user-model' })
    expect(loadConfig(dir)!.routing!.workers.map(w => w.id)).toEqual(['custom', 'deepseek-standard', 'deepseek-strong'])
  })
  it.each([true, false])('switches a changed runner without stale Codex effort (explicit agent: %s)', async explicit => {
    saveConfig(dir, { canonVersion: 'test', agents: ['codex'], loop: { enabled: true }, runner: { ...(explicit ? { agent: 'codex' as const } : {}), model: 'user-model', reasoningEffort: 'high', bare: true } })
    expect(await main(['setup', dir, '--yes', '--runner=qwen', '--model-provider=kimi'])).toBe(0)
    expect(loadConfig(dir)!.runner).toEqual({ agent: 'qwen', model: 'openai::kimi-k2.6' })
  })
  it('preserves an existing Qwen runner that deliberately inherits its model', async () => {
    saveConfig(dir, { canonVersion: 'test', agents: ['qwen'], loop: { enabled: true }, runner: { agent: 'qwen' } })
    expect(await main(['setup', dir, '--yes', '--model-provider=deepseek'])).toBe(0)
    expect(loadConfig(dir)!.runner).toEqual({ agent: 'qwen' })
  })
  it('rejects unknown presets before creating config', async () => {
    expect(await main(['setup', dir, '--yes', '--model-provider=deepseek,typo'])).toBe(1)
    expect(loadConfig(dir)).toBeNull()
  })
  it('keeps default Qwen setup on the users configured model without API opt-in', async () => {
    expect(await main(['setup', dir, '--yes', '--agent=qwen'])).toBe(0)
    expect(settings().modelProviders).toBeUndefined()
    expect(loadConfig(dir)!.routing!.workers).toEqual([expect.objectContaining({ id: 'qwen-standard', agent: 'qwen', tier: 'standard' })])
    expect(loadConfig(dir)!.routing!.workers[0].model).toBeUndefined()
  })
  it('supports explicit auth selectors without changing bare model ids', () => {
    expect(buildProviderInvocation('qwen', 'P', dir, 'safe', { model: 'anthropic::my-model' }).args.slice(-4)).toEqual(['--auth-type', 'anthropic', '--model', 'my-model'])
    expect(buildProviderInvocation('qwen', 'P', dir, 'safe', { model: 'my-org/my-model' }).args.slice(-2)).toEqual(['--model', 'my-org/my-model'])
    expect(() => buildProviderInvocation('qwen', 'P', dir, 'safe', { model: 'typo::my-model' })).toThrow(/auth/)
    expect(() => buildProviderInvocation('qwen', 'P', dir, 'safe', { model: 'openai::--yolo' })).toThrow()
    expect(buildProviderInvocation('qwen', 'P', dir, 'safe', { model: 'openai::deepseek-r1:8b' }).args.slice(-4)).toEqual(['--auth-type', 'openai', '--model', 'deepseek-r1:8b'])
  })
})
