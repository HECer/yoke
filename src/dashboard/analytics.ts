import { readMeasurements } from '../observability/history.js'
import { readEvents, type LoopEvent } from '../observability/events.js'

export interface Period { from: number; to: number; bucket: 'day' | 'week' | 'month' }
export function parsePeriod(params: URLSearchParams, now = Date.now()): Period {
  const to = params.has('to') ? Date.parse(params.get('to')!) : now
  const from = params.has('from') ? Date.parse(params.get('from')!) : to - 30 * 86400000
  const bucket = params.get('bucket') ?? 'day'
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 366 * 86400000 || !['day', 'week', 'month'].includes(bucket)) throw Error('Choose a valid period of at most 366 days and day, week or month grouping')
  return { from, to, bucket: bucket as Period['bucket'] }
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const numeric = (value: unknown) => finite(value) ? value : 0
const name = (value: unknown) => typeof value === 'string' ? value.slice(0, 200) : 'unknown'
function bucketOf(timestamp: string, bucket: Period['bucket']): string {
  const date = new Date(timestamp)
  if (bucket === 'month') return date.toISOString().slice(0, 7)
  if (bucket === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7)
  return date.toISOString().slice(0, 10)
}
function empty() {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, reportedCostUsd: 0,
    measuredCalls: 0, unknownCalls: 0, costReportedCalls: 0, incompleteCosts: 0, callDurationMs: 0, attemptDurationMs: 0,
    attempts: 0, successfulAttempts: 0, accepted: 0, repairs: 0, escalations: 0, unmeasuredAttempts: 0 }
}
type Totals = ReturnType<typeof empty>

export function aggregateMeasurements(events: LoopEvent[], period: Period) {
  const total = empty(), buckets = new Map<string, Totals>(), models = new Map<string, Totals>(), modelBuckets = new Map<string, Totals>(), tasks = new Map<string, Totals>(), phases = new Map<string, number>()
  const modelDetails = new Map<string, { provider: string; model: string; role: string }>()
  const seen = new Set<string>(), accepted = new Set<string>()
  let earliest: string | undefined, latest: string | undefined
  const get = (map: Map<string, Totals>, key: string) => { if (!map.has(key)) map.set(key, empty()); return map.get(key)! }
  for (const event of events) {
    const time = Date.parse(event.timestamp)
    if (seen.has(event.id) || !Number.isFinite(time) || time < period.from || time >= period.to || event.type === 'status') continue
    seen.add(event.id)
    if (!earliest || event.timestamp < earliest) earliest = event.timestamp
    if (!latest || event.timestamp > latest) latest = event.timestamp
    const data = event.data ?? {}, bucket = get(buckets, bucketOf(event.timestamp, period.bucket)), task = get(tasks, event.storyId ?? 'unattributed')
    const targets = [total, bucket, task]
    if (event.type === 'tokens') {
      const calls = Array.isArray(data.calls) && data.calls.length ? data.calls : [{ ...data, actualModel: data.model, durationMs: event.durationMs }]
      for (const item of calls) {
        if (!item || typeof item !== 'object') continue
        const call = item as Record<string, unknown>
        const provider = name(call.provider), model = name(call.actualModel), role = name(call.role)
        const key = JSON.stringify([provider, model, role])
        modelDetails.set(key, { provider, model, role })
        for (const target of [...targets, get(models, key), get(modelBuckets, JSON.stringify([bucketOf(event.timestamp, period.bucket), provider, model, role]))]) {
          target.inputTokens += numeric(call.inputTokens); target.outputTokens += numeric(call.outputTokens)
          target.cachedInputTokens += numeric(call.cachedInputTokens); target.cacheWriteInputTokens += numeric(call.cacheWriteInputTokens)
          target.reportedCostUsd += numeric(call.totalCostUsd); target.callDurationMs += numeric(call.durationMs)
          const measured = finite(call.inputTokens) && finite(call.outputTokens) && call.usageAvailable !== false && call.measurementComplete !== false
          if (measured) target.measuredCalls++; else target.unknownCalls++
          if (finite(call.totalCostUsd)) target.costReportedCalls++
          if (call.costMeasurementComplete === false || data.costMeasurementComplete === false) target.incompleteCosts++
        }
      }
      if (data.escalated === true) for (const target of targets) target.escalations++
    } else if (event.type === 'phase-ended') {
      const phase = name(event.phase)
      phases.set(phase, (phases.get(phase) ?? 0) + numeric(event.durationMs))
      if (phase === 'repairing') for (const target of targets) target.repairs++
    } else if (event.type === 'attempt-ended') {
      for (const target of targets) {
        target.attempts++; target.attemptDurationMs += numeric(event.durationMs)
        if (['completed', 'passed'].includes(event.outcome ?? '')) target.successfulAttempts++
        if (data.usageAvailable !== true) target.unmeasuredAttempts++
      }
    } else if (event.type === 'accepted') {
      const key = event.runId + ':' + (event.storyId ?? event.attemptId ?? event.id)
      if (!accepted.has(key)) { accepted.add(key); for (const target of targets) target.accepted++ }
    }
  }
  const decorate = (value: Totals) => ({ ...value,
    tokensPerCallMinute: value.callDurationMs > 0 ? (value.inputTokens + value.outputTokens) / (value.callDurationMs / 60000) : null,
    tokensPerAccepted: value.accepted ? (value.inputTokens + value.outputTokens) / value.accepted : null,
    timePerAcceptedMs: value.accepted ? value.attemptDurationMs / value.accepted : null,
    costState: value.costReportedCalls === 0 ? 'unknown' : value.costReportedCalls === value.measuredCalls && value.unknownCalls === 0 && value.unmeasuredAttempts === 0 && value.incompleteCosts === 0 ? 'measured' : 'partial',
  })
  return { total: { ...decorate(total), tokensPerElapsedMinute: (total.inputTokens + total.outputTokens) / ((period.to - period.from) / 60000) },
    buckets: [...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, ...decorate(value) })),
    models: [...models].map(([key, value]) => ({ ...modelDetails.get(key)!, ...decorate(value) })),
    modelBuckets: [...modelBuckets].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => { const [label, provider, model, role] = JSON.parse(key) as string[]; return { label, provider, model, role, ...decorate(value) } }),
    tasks: [...tasks].map(([storyId, value]) => ({ storyId, ...decorate(value) })),
    phases: [...phases].map(([phase, durationMs]) => ({ phase, durationMs })), earliest, latest,
  }
}

export function projectAnalytics(root: string, period: Period) {
  const history = readMeasurements(root, period.from, period.to)
  const recent = readEvents(root, 1000)
  return { ...aggregateMeasurements([...history.events, ...recent], period),
    from: new Date(period.from).toISOString(), to: new Date(period.to).toISOString(), bucket: period.bucket, timezone: 'UTC',
    errors: history.errors,
    coverage: 'Recorded measurements only. Earlier unrecorded or expired activity cannot be reconstructed. Usage is assigned to its reporting time; durations to their end time.',
  }
}
