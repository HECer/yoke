export interface DurationEstimate {
  typicalMs: number
  lowerMs: number
  upperMs: number
  sampleCount: number
  /** Evidence strength, not a calibrated probability. */
  confidence: 'low' | 'medium'
}
export const validDuration = (ms: unknown): ms is number => typeof ms === 'number' && Number.isFinite(ms) && ms > 0

/** Robust weighted empirical quantiles; current observations have twice the weight. */
export function estimateDurations(history: readonly number[], current: readonly number[] = []): DurationEstimate | undefined {
  const samples = [...history.filter(validDuration).slice(-50).map(ms => ({ ms, weight: 1 })), ...current.filter(validDuration).slice(-50).map(ms => ({ ms, weight: 2 }))].sort((a, b) => a.ms - b.ms)
  if (!samples.length) return undefined
  const total = samples.reduce((sum, sample) => sum + sample.weight, 0)
  const quantile = (fraction: number) => {
    let seen = 0
    for (let index = 0; index < samples.length; index++) {
      seen += samples[index].weight
      if (seen === total * fraction && index + 1 < samples.length) return (samples[index].ms + samples[index + 1].ms) / 2
      if (seen >= total * fraction) return samples[index].ms
    }
    return samples[samples.length - 1].ms
  }
  return { typicalMs: quantile(0.5), lowerMs: quantile(0.1), upperMs: quantile(0.9), sampleCount: samples.length, confidence: samples.length >= 5 ? 'medium' : 'low' }
}
