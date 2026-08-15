import { describe, expect, it } from 'vitest'
import {
  AgentInvocationSchema,
  MachineEnvelopeSchema,
  ModelSelectionSchema,
  ProviderTelemetrySchema,
} from '../../src/agents/contracts.js'

describe('agent machine contracts', () => {
  it.each(['route', 'review', 'quality', 'decomposition', 'candidate-selection', 'telemetry'] as const)(
    'parses a versioned %s machine envelope',
    role => {
      const envelope = MachineEnvelopeSchema.parse({
        schemaVersion: 1,
        provider: 'codex',
        model: 'provider-current',
        role,
        durationMs: 24,
        permissions: 'safe',
        usage: { inputTokens: 12, outputTokens: 4 },
        raw: { requestId: 'request-1' },
      })

      expect(envelope.role).toBe(role)
    },
  )

  it('rejects an unsupported agent contract version', () => {
    expect(() => MachineEnvelopeSchema.parse({
      schemaVersion: 2,
      provider: 'codex', role: 'review', durationMs: 1, permissions: 'safe',
    })).toThrow()
  })

  it('rejects a machine envelope role outside the shared contract', () => {
    expect(() => MachineEnvelopeSchema.parse({
      schemaVersion: 1,
      provider: 'codex', role: 'agent-invocation', durationMs: 1, permissions: 'safe',
    })).toThrow()
  })

  it('keeps model selections optional and provider identifiers opaque', () => {
    expect(ModelSelectionSchema.parse({ model: 'provider-current', reasoningEffort: 'deep-vNext' }))
      .toEqual({ model: 'provider-current', reasoningEffort: 'deep-vNext' })
  })

  it('requires every agent invocation boundary field', () => {
    expect(() => AgentInvocationSchema.parse({ command: 'codex', args: [], input: 'Review this' })).toThrow()
  })

  it('accepts normalized telemetry only when token totals are present', () => {
    expect(ProviderTelemetrySchema.parse({
      usageAvailable: true,
      tokens: { inputTokens: 12, outputTokens: 4, model: 'gpt-current' },
    })).toEqual({ usageAvailable: true, tokens: { inputTokens: 12, outputTokens: 4, model: 'gpt-current' } })
    expect(() => ProviderTelemetrySchema.parse({ usageAvailable: true })).toThrow()
  })

  it('allows unavailable telemetry without a token payload', () => {
    expect(ProviderTelemetrySchema.parse({ usageAvailable: false })).toEqual({ usageAvailable: false })
  })
})
