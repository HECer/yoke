import { EVENT_CAP, readEvents, type LoopEvent } from './events.js'
import { readMeasurements } from './history.js'

type Coverage = 'measured' | 'partial' | 'unknown'
const fields = ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens', 'totalCostUsd'] as const
type Metric = typeof fields[number]
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const text = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 ? value : undefined

export interface UsageCall extends Record<Metric, number | null> {
  callId: string
  parentCallId?: string
  runId: string
  attemptId?: string
  storyId?: string
  role: string
  provider?: string
  source: string
  coverage: Coverage
  costCoverage: Coverage
  missingFields: Metric[]
  fieldCoverage: Record<Metric, Coverage>
  durationMs: number | null
  counted: boolean
  exclusion?: 'parent-view-overlap'
}

function intervalTotals(events: readonly LoopEvent[]) {
  const intervals = events.flatMap(event => {
    const end = Date.parse(event.timestamp)
    return finite(event.durationMs) && Number.isFinite(end) ? [[end - event.durationMs, end] as const] : []
  }).sort((a, b) => a[0] - b[0])
  if (!intervals.length) return { sumMs: null, unionMs: null }
  let sumMs = 0, unionMs = 0, end = -Infinity
  for (const [start, stop] of intervals) {
    sumMs += stop - start
    unionMs += Math.max(0, stop - Math.max(start, end))
    end = Math.max(end, stop)
  }
  return { sumMs, unionMs }
}

/** Recorded evidence only. Parent views conservatively cover their identified children. */
export function summarizeUsageEvents(input: readonly LoopEvent[]) {
  const events = [...new Map(input.map(event => [event.id, event])).values()]
  const byId = new Map<string, UsageCall>()
  for (const event of events) {
    if (event.type !== 'tokens') continue
    const data = event.data ?? {}
    const breakdown = Array.isArray(data.calls) && data.calls.length > 0
    const records = breakdown ? data.calls as unknown[] : [data]
    records.forEach((record, index) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) return
      const raw = record as Record<string, unknown>
      const callId = text(raw.callId) ?? `${event.id}:${index}`
      // IDs identify views of the same invocation even across reporter run IDs.
      const durationMs = finite(raw.durationMs) ? raw.durationMs : !breakdown && finite(event.durationMs) ? event.durationMs : null
      const previous = byId.get(callId)
      if (previous) {
        previous.durationMs ??= durationMs
        return
      }
      const missing = Array.isArray(raw.usageMissingFields) ? raw.usageMissingFields : []
      const partial = Array.isArray(raw.usagePartialFields) ? raw.usagePartialFields : []
      const metrics = Object.fromEntries(fields.map(field => [field, !missing.includes(field) && finite(raw[field]) ? raw[field] : null])) as Record<Metric, number | null>
      const complete = raw.usageAvailable !== false && raw.measurementComplete !== false
        && (breakdown || (data.usageAvailable !== false && data.measurementComplete !== false))
        && metrics.inputTokens !== null && metrics.outputTokens !== null
      const coverage: Coverage = complete ? 'measured' : fields.some(field => metrics[field] !== null) ? 'partial' : 'unknown'
      byId.set(callId, {
        ...metrics, callId, parentCallId: text(raw.parentCallId ?? data.parentCallId), runId: event.runId,
        attemptId: event.attemptId, storyId: event.storyId,
        role: text(raw.role ?? event.role ?? data.role) ?? 'unknown',
        provider: text(raw.provider ?? event.provider ?? data.provider ?? event.agent),
        source: text(raw.usageSource ?? data.usageSource) ?? 'local-event', coverage,
        costCoverage: metrics.totalCostUsd === null ? 'unknown' : raw.costMeasurementComplete === false || (!breakdown && data.costMeasurementComplete === false) ? 'partial' : 'measured',
        missingFields: fields.filter(field => metrics[field] === null),
        fieldCoverage: Object.fromEntries(fields.map(field => [field, metrics[field] === null ? 'unknown' : partial.includes(field) ? 'partial' : 'measured'])) as Record<Metric, Coverage>,
        durationMs,
        counted: true,
      })
    })
  }
  const calls = [...byId.values()]
  for (const call of calls) {
    if (call.parentCallId && byId.has(call.parentCallId)) {
      call.counted = false
      call.exclusion = 'parent-view-overlap'
    }
  }
  const counted = calls.filter(call => call.counted)
  const sum = (key: Metric | 'durationMs', values = counted): number | null => {
    const measured = values.map(call => call[key]).filter((value): value is number => value !== null)
    return measured.length ? measured.reduce((total, value) => total + value, 0) : null
  }
  const coverage = (values: UsageCall[]): Coverage => !values.length || values.every(call => call.coverage === 'unknown') ? 'unknown' : values.every(call => call.coverage === 'measured') ? 'measured' : 'partial'
  const unmeasuredAttempts = events.filter(event => event.type === 'attempt-ended' && !calls.some(call => call.runId === event.runId && call.attemptId === event.attemptId)).length
  const inputTokens = sum('inputTokens'), outputTokens = sum('outputTokens')
  const phases = events.filter(event => event.type === 'phase-ended')
  const phaseTime = intervalTotals(phases), attemptTime = intervalTotals(events.filter(event => event.type === 'attempt-ended'))
  const failures = { observer: 0, infrastructure: 0, product: 0, unknown: 0 }
  for (const event of events) {
    if (!['failed', 'blocked', 'rejected', 'error'].includes(event.outcome ?? '')) continue
    const category = event.data?.failureCategory
    failures[category === 'observer' || category === 'infrastructure' || category === 'product' ? category : 'unknown']++
  }
  return {
    calls,
    total: { inputTokens, cachedInputTokens: sum('cachedInputTokens'), outputTokens, reasoningOutputTokens: sum('reasoningOutputTokens'),
      totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
      totalCostUsd: sum('totalCostUsd'), coverage: unmeasuredAttempts && coverage(counted) === 'measured' ? 'partial' as Coverage : coverage(counted),
      costCoverage: !counted.length || counted.every(call => call.costCoverage === 'unknown') ? 'unknown' : counted.every(call => call.costCoverage === 'measured') && !unmeasuredAttempts ? 'measured' : 'partial',
    },
    hostCoverage: { guardian: coverage(calls.filter(call => call.role === 'guardian')), approval: coverage(calls.filter(call => call.role === 'approval')) },
    time: { workerProcessDurationMs: sum('durationMs', counted.filter(call => call.role === 'worker')),
      phaseDurationSumMs: phaseTime.sumMs, phaseDurationUnionMs: phaseTime.unionMs,
      attemptDurationSumMs: attemptTime.sumMs, attemptDurationUnionMs: attemptTime.unionMs,
      phases: [...new Set(phases.map(event => event.phase ?? 'unknown'))].sort().map(phase => ({ phase, ...intervalTotals(phases.filter(event => (event.phase ?? 'unknown') === phase)) })),
    },
    failures, unmeasuredAttempts,
    limitations: ['Recorded local events only; unrecorded host sessions and approvals remain unknown.',
      'Totals are known lower bounds when coverage is partial; missing prices remain unknown.',
      'Cache read is contained in input; reasoning is contained in output.',
      'Identified child views are excluded when a parent view exists; disjoint usage is not assumed.',
      'Intervals derive from recorded end times and durations; unrecorded waiting time is unknown.'],
  }
}

/** No model/provider invocation: reads bounded local history and recent events. */
export function localUsageReport(root: string, options: { from: number; to: number; runId?: string }) {
  const { from, to, runId } = options
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 366 * 86400000) throw Error('Choose a valid period of at most 366 days')
  const history = readMeasurements(root, from, to)
  const events = [...history.events, ...readEvents(root, EVENT_CAP)].filter(event => {
    const time = Date.parse(event.timestamp)
    return time >= from && time < to && (!runId || event.runId === runId)
  })
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), ...summarizeUsageEvents(events), errors: history.errors }
}
