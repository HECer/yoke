import { readMeasurements } from '../observability/history.js'
import { readEvents, type LoopEvent } from '../observability/events.js'
import { DASHBOARD_LIMITS } from './contracts.js'

export interface Period { from: number; to: number; bucket: 'day' | 'week' | 'month' }
export function parsePeriod(params: URLSearchParams, now = Date.now()): Period {
  const to = params.has('to') ? Date.parse(params.get('to')!) : now
  const from = params.has('from') ? Date.parse(params.get('from')!) : to - 30 * 86400000
  const bucket = params.get('bucket') ?? 'day'
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 366 * 86400000 || !['day', 'week', 'month'].includes(bucket)) throw Error('Choose a valid period of at most 366 days and day, week or month grouping')
  return { from, to, bucket: bucket as Period['bucket'] }
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const name = (value: unknown) => typeof value === 'string' ? value.slice(0, 200) : 'unknown'
function bucketOf(timestamp: string, bucket: Period['bucket']): string {
  const date = new Date(timestamp)
  if (bucket === 'month') return date.toISOString().slice(0, 7)
  if (bucket === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7)
  return date.toISOString().slice(0, 10)
}
export interface MeasurementTotals {
  inputTokens: number | null
  outputTokens: number | null
  cachedInputTokens: number | null
  cacheWriteInputTokens: number | null
  reasoningOutputTokens: number | null
  reportedCostUsd: number | null
  measuredCalls: number
  unknownCalls: number
  costReportedCalls: number
  incompleteCosts: number
  callDurationMs: number | null
  attemptDurationMs: number | null
  attempts: number
  successfulAttempts: number
  accepted: number
  repairs: number
  escalations: number
  unmeasuredAttempts: number
}
export type CostState = 'unknown' | 'partial' | 'measured'
export interface ProjectedTotals extends MeasurementTotals {
  tokensPerCallMinute: number | null
  tokensPerAccepted: number | null
  timePerAcceptedMs: number | null
  costState: CostState
  tokensPerElapsedMinute?: number | null
}
type Totals = MeasurementTotals
type AdditiveMetric = 'inputTokens' | 'outputTokens' | 'cachedInputTokens' | 'cacheWriteInputTokens' | 'reasoningOutputTokens' | 'reportedCostUsd' | 'callDurationMs' | 'attemptDurationMs'
function empty(): Totals {
  return { inputTokens: null, outputTokens: null, cachedInputTokens: null, cacheWriteInputTokens: null, reasoningOutputTokens: null, reportedCostUsd: null,
    measuredCalls: 0, unknownCalls: 0, costReportedCalls: 0, incompleteCosts: 0, callDurationMs: null, attemptDurationMs: null,
    attempts: 0, successfulAttempts: 0, accepted: 0, repairs: 0, escalations: 0, unmeasuredAttempts: 0 }
}
function addMetric(target: Totals, key: AdditiveMetric, value: unknown): void {
  if (finite(value)) target[key] = (target[key] ?? 0) + value
}

export function aggregateMeasurements(events: LoopEvent[], period: Period) {
  const total = empty(), buckets = new Map<string, Totals>(), models = new Map<string, Totals>(), modelBuckets = new Map<string, Totals>(), tasks = new Map<string, Totals>(), phases = new Map<string, number | null>()
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
          addMetric(target, 'inputTokens', call.inputTokens); addMetric(target, 'outputTokens', call.outputTokens)
          addMetric(target, 'cachedInputTokens', call.cachedInputTokens); addMetric(target, 'cacheWriteInputTokens', call.cacheWriteInputTokens)
          addMetric(target, 'reasoningOutputTokens', call.reasoningOutputTokens); addMetric(target, 'reportedCostUsd', call.totalCostUsd); addMetric(target, 'callDurationMs', call.durationMs)
          const measured = finite(call.inputTokens) && finite(call.outputTokens) && call.usageAvailable !== false && call.measurementComplete !== false
          if (measured) target.measuredCalls++; else target.unknownCalls++
          if (finite(call.totalCostUsd)) target.costReportedCalls++
          if (call.costMeasurementComplete === false || data.costMeasurementComplete === false) target.incompleteCosts++
        }
      }
      if (data.escalated === true) for (const target of targets) target.escalations++
    } else if (event.type === 'phase-ended') {
      const phase = name(event.phase)
      const duration = phases.get(phase)
      if (finite(event.durationMs)) phases.set(phase, (duration ?? 0) + event.durationMs)
      else if (duration === undefined) phases.set(phase, null)
      if (phase === 'repairing') for (const target of targets) target.repairs++
    } else if (event.type === 'attempt-ended') {
      for (const target of targets) {
        target.attempts++; addMetric(target, 'attemptDurationMs', event.durationMs)
        if (['completed', 'passed'].includes(event.outcome ?? '')) target.successfulAttempts++
        if (data.usageAvailable !== true) target.unmeasuredAttempts++
      }
    } else if (event.type === 'accepted') {
      const key = event.runId + ':' + (event.storyId ?? event.attemptId ?? event.id)
      if (!accepted.has(key)) { accepted.add(key); for (const target of targets) target.accepted++ }
    }
  }
  const decorate = (value: Totals): ProjectedTotals => {
    const tokens = value.inputTokens !== null && value.outputTokens !== null ? value.inputTokens + value.outputTokens : null
    return { ...value,
      tokensPerCallMinute: tokens !== null && value.callDurationMs !== null && value.callDurationMs > 0 ? tokens / (value.callDurationMs / 60000) : null,
      tokensPerAccepted: tokens !== null && value.accepted ? tokens / value.accepted : null,
      timePerAcceptedMs: value.accepted && value.attemptDurationMs !== null ? value.attemptDurationMs / value.accepted : null,
      costState: value.costReportedCalls === 0 ? 'unknown' : value.costReportedCalls === value.measuredCalls && value.unknownCalls === 0 && value.unmeasuredAttempts === 0 && value.incompleteCosts === 0 ? 'measured' : 'partial',
    }
  }
  const decoratedTotal = decorate(total)
  return { total: { ...decoratedTotal, tokensPerElapsedMinute: decoratedTotal.tokensPerCallMinute === null && (total.inputTokens === null || total.outputTokens === null) ? null : (total.inputTokens! + total.outputTokens!) / ((period.to - period.from) / 60000) },
    buckets: [...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, ...decorate(value) })),
    models: [...models].map(([key, value]) => ({ ...modelDetails.get(key)!, ...decorate(value) })),
    modelBuckets: [...modelBuckets].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => { const [label, provider, model, role] = JSON.parse(key) as string[]; return { label, provider, model, role, ...decorate(value) } }),
    tasks: [...tasks].map(([storyId, value]) => ({ storyId, ...decorate(value) })),
    phases: [...phases].map(([phase, durationMs]) => ({ phase, durationMs })), earliest, latest,
  }
}

export interface DashboardProjectReference { id: string; root: string; name: string; error?: string }
export interface ProjectHistory {
  from: string
  to: string
  bucket: Period['bucket']
  timezone: 'UTC'
  events: LoopEvent[]
  errors: string[]
  coverage: string
}
export function projectHistory(root: string, period: Period, limit: number = DASHBOARD_LIMITS.events): ProjectHistory {
  if (!Number.isInteger(limit) || limit < 1 || limit > DASHBOARD_LIMITS.events) throw Error('Limit must be an integer from 1 to ' + DASHBOARD_LIMITS.events)
  const history = readMeasurements(root, period.from, period.to), seen = new Set<string>()
  const events = [...history.events, ...readEvents(root, limit)].filter(event => {
    const time = Date.parse(event.timestamp)
    if (seen.has(event.id) || !Number.isFinite(time) || time < period.from || time >= period.to) return false
    seen.add(event.id); return true
  }).sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-limit)
  return { from: new Date(period.from).toISOString(), to: new Date(period.to).toISOString(), bucket: period.bucket, timezone: 'UTC', events, errors: history.errors,
    coverage: 'Recorded measurements only. Earlier unrecorded or expired activity cannot be reconstructed. Usage is assigned to its reporting time; durations to their end time.' }
}

export function workspaceAnalytics(projects: readonly DashboardProjectReference[], period: Period) {
  const rows = projects.slice(0, DASHBOARD_LIMITS.projects).map(project => {
    if (project.error || !project.root) return { id: project.id, name: project.name, analytics: null, errors: [project.error ?? 'Project directory is unavailable'] }
    try { return { id: project.id, name: project.name, analytics: projectAnalytics(project.root, period), errors: [] } }
    catch (error) { return { id: project.id, name: project.name, analytics: null, errors: [(error as Error).message] } }
  })
  return { from: new Date(period.from).toISOString(), to: new Date(period.to).toISOString(), bucket: period.bucket, timezone: 'UTC' as const, projects: rows, errors: rows.flatMap(row => row.errors) }
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
