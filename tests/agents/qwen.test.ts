import { describe, expect, it } from 'vitest'
import { buildProviderInvocation } from '../../src/agents/providers.js'
import { parseProviderResult, parseProviderTelemetry } from '../../src/agents/telemetry.js'
import { createTelemetryAccumulator } from '../../src/agents/process-streams.js'

const json = JSON.stringify
const verdict = { schemaVersion: 1, verdict: 'pass' }
describe('Qwen Code native contract', () => {
  it('reads the native result envelope and ignores subagent results', () => {
    expect(parseProviderResult('qwen', [
      json({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Checking...' }] } }),
      json({ type: 'result', parent_tool_use_id: 'nested', result: json({ schemaVersion: 1, verdict: 'fail' }) }),
      json({ type: 'result', is_error: false, result: json(verdict) }),
    ].join('\n'))).toEqual(verdict)
  })
  it('reads native text blocks without consuming reasoning or tool inputs', () => {
    expect(parseProviderResult('qwen', json({ type: 'assistant', message: { content: [
      { type: 'thinking', thinking: 'internal' }, { type: 'tool_use', input: verdict },
      { type: 'text', text: json(verdict) },
    ] } }))).toEqual(verdict)
  })
  it('does not accept an earlier verdict after a terminal failure', () => {
    expect(parseProviderResult('qwen', [
      json({ type: 'assistant', message: { content: [{ type: 'text', text: json(verdict) }] } }),
      json({ type: 'result', is_error: true, error: { message: 'provider failed' } }),
    ].join('\n'))).toBeNull()
  })
  it('reads native structured_result', () => {
    expect(parseProviderResult('qwen', json({ type: 'result', is_error: false, structured_result: verdict }))).toEqual(verdict)
  })
  it('keeps cumulative totals and all model identities through chunked output', () => {
    const accumulator = createTelemetryAccumulator('qwen')
    const output = [
      json({ type: 'system', subtype: 'session_start', model: 'qwen3-coder-plus' }),
      json({ type: 'assistant', message: { model: 'qwen3-coder-plus', usage: { input_tokens: 10, output_tokens: 4 } } }),
      json({ type: 'result', usage: { input_tokens: 100, output_tokens: 30, cache_read_input_tokens: 20 }, stats: { models: {
        'qwen3-coder-plus': { tokens: { prompt: 80, candidates: 20, thoughts: 3 } },
        'qwen3.7-plus': { tokens: { prompt: 20, candidates: 10, thoughts: 2 } },
      } } }),
    ].join('\n')
    for (let i = 0; i < output.length; i += 17) accumulator.append(output.slice(i, i + 17))
    expect(accumulator.finish()).toEqual({ usageAvailable: true, tokens: { inputTokens: 100, outputTokens: 30, cachedInputTokens: 20, reasoningOutputTokens: 5 }, reportedModels: ['qwen3-coder-plus', 'qwen3.7-plus'] })
  })
  it('reads native per-model token stats when result usage is absent', () => {
    expect(parseProviderTelemetry('qwen', [json({ type: 'result', stats: { models: { 'kimi-k3': { tokens: { prompt: 100, candidates: 20, cached: 10, thoughts: 5 } } } } })]).tokens)
      .toEqual({ inputTokens: 100, outputTokens: 20, cachedInputTokens: 10, reasoningOutputTokens: 5, model: 'kimi-k3' })
  })
  it('ignores nested result usage', () => {
    expect(parseProviderTelemetry('qwen', [
      json({ type: 'result', usage: { input_tokens: 100, output_tokens: 20 } }),
      json({ type: 'result', parent_tool_use_id: 'nested', usage: { input_tokens: 5, output_tokens: 1 } }),
    ]).tokens).toMatchObject({ inputTokens: 100, outputTokens: 20 })
  })
  it('uses native approval modes and blocks delegation when requested', () => {
    expect(buildProviderInvocation('qwen', 'P', '/w', 'safe').args).toContain('auto-edit')
    const args = buildProviderInvocation('qwen', 'P', '/w', 'safe', { nativeMultiAgent: false }).args
    expect(args).toContain('--sandbox')
    expect(args).toContain('--allowed-tools')
    expect(args).toContain('run_shell_command')
    expect(args).toContain('--exclude-tools')
    expect(args).toContain('agent')
    expect(args).toContain('create_sub_session')
    expect(args).toContain('team_create')
    expect(buildProviderInvocation('qwen', 'P', '/w', 'read-only').args).toContain('plan')
    expect(buildProviderInvocation('qwen', 'P', '/w', 'unsafe').args).toContain('--yolo')
  })
  it('keeps unsupported Qwen options explicit', () => {
    for (const selection of [{ bare: true }, { reasoningEffort: 'high' }, { nativeMultiAgent: true }]) {
      expect(() => buildProviderInvocation('qwen', 'P', '/w', 'safe', selection)).toThrow(/Qwen/)
    }
  })
})
