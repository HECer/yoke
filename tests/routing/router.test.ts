import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildRoutingPrompt, makeAdaptiveRunner, parseRouteDecision, rankWorkers } from '../../src/routing/router.js'
import type { RoutingWorker } from '../../src/retrofit/config.js'

const workers: RoutingWorker[] = [
  { id: 'claude-fast', agent: 'claude', model: 'haiku', costTier: 'low', capabilities: ['tests'] },
  { id: 'codex-deep', agent: 'codex', model: 'strong', costTier: 'high', capabilities: ['security'] },
]
const story = { id: 'S1', title: 'Add secure login', priority: 1, acceptance: ['reject invalid credentials'], passes: false }
let registry: string

beforeEach(() => {
  registry = mkdtempSync(join(tmpdir(), 'yoke-routing-registry-'))
  process.env.YOKE_REGISTRY_DIR = registry
})
afterEach(() => {
  delete process.env.YOKE_REGISTRY_DIR
  rmSync(registry, { recursive: true, force: true })
})

describe('routing control prompt', () => {
  it('is compact, lists only allowed candidates, and always permits SELF', () => {
    const prompt = buildRoutingPrompt({ targetDir: '/work', story }, workers, 'balanced')
    expect(prompt).toContain('SELF')
    expect(prompt).toContain('claude-fast')
    expect(prompt).toContain('codex-deep')
    expect(prompt).not.toContain('/work')
    expect(prompt).toContain('Do not inspect files')
  })

  it('renders structured acceptance criteria for adaptive routing decisions', () => {
    const prompt = buildRoutingPrompt({
      targetDir: '/work',
      story: {
        ...story,
        acceptance: [{ id: 'login-rejected', text: 'Invalid credentials are rejected', verify: ['npm run test:auth'] }],
      },
    }, workers, 'balanced')

    expect(prompt).toContain('[login-rejected] Invalid credentials are rejected')
    expect(prompt).toContain('npm run test:auth')
    expect(prompt).not.toContain('[object Object]')
  })

  it('extracts a route marker nested inside provider JSONL', () => {
    const output = JSON.stringify({ type: 'item.completed', item: { text: 'YOKE_ROUTE {"worker":"claude-fast","reason":"cheap bounded tests"}' } })
    expect(parseRouteDecision(output, workers.map(worker => worker.id))).toEqual({ worker: 'claude-fast', reason: 'cheap bounded tests' })
  })

  it('rejects invented candidates and malformed control output', () => {
    expect(parseRouteDecision('YOKE_ROUTE {"worker":"unknown","reason":"x"}', ['claude-fast'])).toBeNull()
    expect(parseRouteDecision('choose claude-fast', ['claude-fast'])).toBeNull()
  })

  it('applies the cost strategy before limiting what the parent sees', () => {
    expect(rankWorkers(workers, 'cost', 1).map(worker => worker.id)).toEqual(['claude-fast'])
  })
})

describe('adaptive runner', () => {
  it('routes to the selected worker and accounts for orchestration plus execution', () => {
    const moments = [0, 10, 20, 50]
    const selected: Array<{ agent: string; model?: string }> = []
    const runner = makeAdaptiveRunner({
      parent: 'codex', parentSelection: { model: 'parent' }, workers, strategy: 'balanced', maxCandidates: 2,
      isAvailable: () => true,
      now: () => moments.shift() ?? 50,
      captureRoute: () => ({
        success: true,
        output: 'YOKE_ROUTE {"worker":"claude-fast","reason":"bounded work"}',
        summary: 'ok',
        tokens: { inputTokens: 10, cachedInputTokens: 6, outputTokens: 2, reasoningOutputTokens: 1, model: 'parent' },
      }),
      makeWorker: (agent, selection) => {
        selected.push({ agent, model: selection.model })
        return () => ({ success: true, summary: 'done', tokens: { inputTokens: 30, cachedInputTokens: 20, outputTokens: 8, reasoningOutputTokens: 3, model: 'resolved-haiku' } })
      },
    })
    const result = runner({ targetDir: registry, story })
    expect(selected).toEqual([{ agent: 'claude', model: 'haiku' }])
    expect(result.success).toBe(true)
    expect(result.summary).toContain('route=claude-fast')
    expect(result.tokens).toMatchObject({ inputTokens: 40, cachedInputTokens: 26, outputTokens: 10, reasoningOutputTokens: 4, model: 'resolved-haiku' })
    expect(result.tokens?.calls).toHaveLength(2)
    expect(result.tokens?.calls?.[0]).toMatchObject({ role: 'orchestrator', durationMs: 10 })
    expect(result.tokens?.calls?.[1]).toMatchObject({ role: 'worker', profile: 'claude-fast', requestedModel: 'haiku', durationMs: 30 })
    expect(readdirSync(registry)).toEqual([])
    result.routing?.recordOutcome(true)
    result.routing?.recordOutcome(false)
    const eventFile = readdirSync(join(registry, 'events'))[0]
    const event = JSON.parse(readFileSync(join(registry, 'events', eventFile), 'utf8'))
    expect(event).toMatchObject({ selected: 'claude-fast', processSuccess: true, verificationSuccess: true })
  })

  it('falls back to SELF when the orchestration response is invalid', () => {
    const used: string[] = []
    const runner = makeAdaptiveRunner({
      parent: 'gemini', workers, strategy: 'cost', maxCandidates: 2,
      captureRoute: () => ({ success: true, output: 'not a route', summary: 'ok' }),
      makeWorker: agent => { used.push(agent); return () => ({ success: true, summary: 'done' }) },
    })
    expect(runner({ targetDir: registry, story }).summary).toContain('invalid routing response')
    expect(used).toEqual(['gemini'])
  })
})
