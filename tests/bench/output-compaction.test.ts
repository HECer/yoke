import { describe, expect, it } from 'vitest'
import { runOutputCompactionBenchmark } from '../../bench/output-compaction.mjs'

describe('output compaction benchmark', () => {
  it('retains actionable signals and round-trips the raw evidence digest', async () => {
    const result = await runOutputCompactionBenchmark()

    expect(result.fixture).toBe('gate-output-v1')
    expect(result.previewBytes).toBeLessThanOrEqual(result.previewBudgetBytes)
    expect(result.rawBytes).toBeGreaterThan(result.referencedBytes)
    expect(result.compressionRatio).toBeGreaterThan(1)
    expect(result.earlyErrorRetained).toBe(true)
    expect(result.finalSummaryRetained).toBe(true)
    expect(result.digestRoundTrip).toBe(true)
  })
})
