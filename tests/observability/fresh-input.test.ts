import { expect, it } from 'vitest'
import { providerTelemetryUsage } from '../../src/observability/usage.js'
import type { ProviderTelemetry } from '../../src/agents/contracts.js'
import { parseProviderTelemetry } from '../../src/agents/telemetry.js'

const telemetry = (tokens: object, partialUsage?: object): ProviderTelemetry => ({ tokens, partialUsage, usageAvailable: true } as ProviderTelemetry)
it('derives fresh input only from complete measured input and cache subsets', () => {
  expect(providerTelemetryUsage(telemetry({ inputTokens: 100, cachedInputTokens: 70, outputTokens: 20 }), 'codex')?.freshInputTokens).toBe(30)
  expect(providerTelemetryUsage(telemetry({ inputTokens: 100, outputTokens: 20 }))?.freshInputTokens).toBeUndefined()
  expect(providerTelemetryUsage(telemetry({ inputTokens: 100, outputTokens: 20 }, { cachedInputTokens: 70 }))?.freshInputTokens).toBeUndefined()
  expect(providerTelemetryUsage(telemetry({ inputTokens: 100, cachedInputTokens: 110, outputTokens: 20 }))?.freshInputTokens).toBeUndefined()
})
it('preserves Claude uncached input semantics instead of subtracting its cache read count', () => {
  const parsed = parseProviderTelemetry('claude', ['{"type":"result","usage":{"input_tokens":10,"cache_read_input_tokens":8,"cache_creation_input_tokens":4,"output_tokens":2}}'])
  expect(providerTelemetryUsage(parsed, 'claude')?.freshInputTokens).toBe(10)
  expect(providerTelemetryUsage(parsed)?.freshInputTokens).toBeUndefined()
})
