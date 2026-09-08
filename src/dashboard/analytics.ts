import { readMeasurements } from '../observability/history.js'
import { EVENT_CAP, readEvents, type LoopEvent } from '../observability/events.js'
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
  activity: number
}
export type CostState = 'unknown' | 'partial' | 'measured'
export interface AggregateTokens {
  input: number | null
  output: number | null
  cachedInput: number | null
  cacheWriteInput: number | null
  reasoningOutput: number | null
  total: number | null
}
export interface AggregateCalls {
  measured: number
  unknown: number
  total: number
}
export interface AggregateOutcomes {
  attempts: number
  successfulAttempts: number
  accepted: number
  repairs: number
  escalations: number
}
export interface AggregateTime {
  callDurationMs: number | null
  attemptDurationMs: number | null
  elapsedMs: number | null
}
export interface AggregateCost {
  reportedUsd: number | null
  reportedCalls: number
  incompleteCalls: number
  state: CostState
  coverage: CostState
}
export interface ProjectedTotals extends MeasurementTotals {
  tokensPerCallMinute: number | null
  tokensPerAccepted: number | null
  timePerAcceptedMs: number | null
  costState: CostState
  tokensPerElapsedMinute?: number | null
  tokens: AggregateTokens
  calls: AggregateCalls
  outcomes: AggregateOutcomes
  time: AggregateTime
  cost: AggregateCost
  attention: number
}
type Totals = MeasurementTotals
type AdditiveMetric = 'inputTokens' | 'outputTokens' | 'cachedInputTokens' | 'cacheWriteInputTokens' | 'reasoningOutputTokens' | 'reportedCostUsd' | 'callDurationMs' | 'attemptDurationMs'
type DimensionKind = 'agents' | 'providers' | 'variants' | 'roles' | 'phases'
function empty(): Totals {
  return { inputTokens: null, outputTokens: null, cachedInputTokens: null, cacheWriteInputTokens: null, reasoningOutputTokens: null, reportedCostUsd: null,
    measuredCalls: 0, unknownCalls: 0, costReportedCalls: 0, incompleteCosts: 0, callDurationMs: null, attemptDurationMs: null,
    attempts: 0, successfulAttempts: 0, accepted: 0, repairs: 0, escalations: 0, unmeasuredAttempts: 0, activity: 0 }
}
function addMetric(target: Totals, key: AdditiveMetric, value: unknown): void {
  if (finite(value)) target[key] = (target[key] ?? 0) + value
}

export function aggregateMeasurements(events: LoopEvent[], period: Period) {
  const total = empty(), buckets = new Map<string, Totals>(), models = new Map<string, Totals>(), modelBuckets = new Map<string, Totals>(), tasks = new Map<string, Totals>()
  const dimensions: Record<DimensionKind, Map<string, Totals>> = { agents: new Map(), providers: new Map(), variants: new Map(), roles: new Map(), phases: new Map() }
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
    for (const target of targets) target.activity++
    if (event.type === 'tokens') {
      const calls = Array.isArray(data.calls) && data.calls.length ? data.calls : [{ ...data, actualModel: data.model, durationMs: event.durationMs }]
      for (const item of calls) {
        if (!item || typeof item !== 'object') continue
        const call = item as Record<string, unknown>
        const provider = name(call.provider ?? data.provider), model = name(call.actualModel ?? call.model ?? data.actualModel ?? data.model), role = name(call.role ?? data.role)
        const key = JSON.stringify([provider, model, role])
        modelDetails.set(key, { provider, model, role })
        const dimensionTargets: Totals[] = []
        for (const [kind, value] of Object.entries({
          agents: name(call.agent ?? data.agent ?? data.agentName ?? data.provider),
          providers: provider,
          variants: name(call.variant ?? data.variant),
          roles: role,
        }) as [DimensionKind, string][]) {
          const dimension = get(dimensions[kind], value)
          dimension.activity++
          dimensionTargets.push(dimension)
        }
        for (const target of [...targets, get(models, key), get(modelBuckets, JSON.stringify([bucketOf(event.timestamp, period.bucket), provider, model, role])), ...dimensionTargets]) {
          const usageAvailable = call.usageAvailable !== false && data.usageAvailable !== false && call.measurementComplete !== false && data.measurementComplete !== false
          if (usageAvailable) {
            addMetric(target, 'inputTokens', call.inputTokens); addMetric(target, 'outputTokens', call.outputTokens)
            addMetric(target, 'cachedInputTokens', call.cachedInputTokens); addMetric(target, 'cacheWriteInputTokens', call.cacheWriteInputTokens)
            addMetric(target, 'reasoningOutputTokens', call.reasoningOutputTokens)
          }
          addMetric(target, 'reportedCostUsd', call.totalCostUsd); addMetric(target, 'callDurationMs', call.durationMs)
          const measured = finite(call.inputTokens) && finite(call.outputTokens) && usageAvailable
          if (measured) target.measuredCalls++; else target.unknownCalls++
          if (finite(call.totalCostUsd)) target.costReportedCalls++
          if (call.costMeasurementComplete === false || data.costMeasurementComplete === false) target.incompleteCosts++
        }
      }
      if (data.escalated === true) for (const target of targets) target.escalations++
    } else if (event.type === 'phase-ended') {
      const phase = name(event.phase)
      const phaseTarget = get(dimensions.phases, phase)
      phaseTarget.activity++
      addMetric(phaseTarget, 'attemptDurationMs', event.durationMs)
      if (phase === 'repairing') phaseTarget.repairs++
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
    const costState = value.costReportedCalls === 0 ? 'unknown' : value.costReportedCalls === value.measuredCalls && value.unknownCalls === 0 && value.unmeasuredAttempts === 0 && value.incompleteCosts === 0 ? 'measured' : 'partial'
    return { ...value,
      tokensPerCallMinute: tokens !== null && value.callDurationMs !== null && value.callDurationMs > 0 ? tokens / (value.callDurationMs / 60000) : null,
      tokensPerAccepted: tokens !== null && value.accepted ? tokens / value.accepted : null,
      timePerAcceptedMs: value.accepted && value.attemptDurationMs !== null ? value.attemptDurationMs / value.accepted : null,
      costState,
      attention: value.unknownCalls + value.unmeasuredAttempts + value.incompleteCosts + Math.max(0, value.attempts - value.successfulAttempts) + value.repairs + value.escalations,
      tokens: { input: value.inputTokens, output: value.outputTokens, cachedInput: value.cachedInputTokens, cacheWriteInput: value.cacheWriteInputTokens, reasoningOutput: value.reasoningOutputTokens, total: tokens },
      calls: { measured: value.measuredCalls, unknown: value.unknownCalls, total: value.measuredCalls + value.unknownCalls },
      outcomes: { attempts: value.attempts, successfulAttempts: value.successfulAttempts, accepted: value.accepted, repairs: value.repairs, escalations: value.escalations },
      time: { callDurationMs: value.callDurationMs, attemptDurationMs: value.attemptDurationMs, elapsedMs: value.attemptDurationMs },
      cost: { reportedUsd: value.reportedCostUsd, reportedCalls: value.costReportedCalls, incompleteCalls: value.incompleteCosts, state: costState, coverage: costState },
    }
  }
  const dimensionRows = (kind: DimensionKind) => [...dimensions[kind]].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, value]) => ({ name, ...decorate(value) }))
  const phaseRows = dimensionRows('phases').map(row => ({ phase: row.name, durationMs: row.time.attemptDurationMs, ...row }))
  const decoratedTotal = decorate(total)
  return { total: { ...decoratedTotal, tokensPerElapsedMinute: decoratedTotal.tokensPerCallMinute === null && (total.inputTokens === null || total.outputTokens === null) ? null : (total.inputTokens! + total.outputTokens!) / ((period.to - period.from) / 60000) },
    buckets: [...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, ...decorate(value) })),
    models: [...models].map(([key, value]) => ({ ...modelDetails.get(key)!, ...decorate(value) })),
    modelBuckets: [...modelBuckets].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => { const [label, provider, model, role] = JSON.parse(key) as string[]; return { label, provider, model, role, ...decorate(value) } }),
    tasks: [...tasks].map(([storyId, value]) => ({ storyId, ...decorate(value) })),
    phases: phaseRows, earliest, latest,
    dimensions: { agents: dimensionRows('agents'), providers: dimensionRows('providers'), variants: dimensionRows('variants'), roles: dimensionRows('roles'), phases: phaseRows },
    agents: dimensionRows('agents'), providers: dimensionRows('providers'), variants: dimensionRows('variants'), roles: dimensionRows('roles'),
  }
}

export type RankingKey = 'attention' | 'activity' | 'tokens' | 'cost' | 'acceptance' | 'name'
export function parseRanking(params: URLSearchParams): RankingKey {
  const value = params.get('sort') ?? 'attention'
  if (!['attention', 'activity', 'tokens', 'cost', 'acceptance', 'name'].includes(value)) throw Error('Choose a valid ranking: attention, activity, tokens, cost, acceptance or name')
  return value as RankingKey
}
export interface RankingProjection {
  name: string
  attention: number
  activity: number | null
  tokens: number | null
  cost: number | null
  acceptance: number | null
  costState: CostState
}
export type RankingViews<T> = Record<RankingKey, T[]>
export interface DashboardProjectReference { id: string; root: string; name: string; error?: string; attention?: number }

function compareNames(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0 }
function compareMetric(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return right - left
}
function rankingComparator<T extends RankingProjection>(key: RankingKey): (left: T, right: T) => number {
  return (left, right) => {
    if (key === 'name') return compareNames(left.name, right.name) || compareNames(JSON.stringify(left), JSON.stringify(right))
    return compareMetric(left[key], right[key]) || compareNames(left.name, right.name) || compareNames(JSON.stringify(left), JSON.stringify(right))
  }
}
export function rankProjections<T extends RankingProjection>(rows: readonly T[]): RankingViews<T> {
  const views = {} as RankingViews<T>
  for (const key of ['attention', 'activity', 'tokens', 'cost', 'acceptance', 'name'] as const) views[key] = [...rows].sort(rankingComparator(key))
  return views
}
function rankingRow(name: string, value: ProjectedTotals): RankingProjection & { total: ProjectedTotals } {
  return { name, attention: value.attention, activity: value.activity, tokens: value.tokens.total, cost: value.cost.reportedUsd, acceptance: value.outcomes.accepted, costState: value.costState, total: value }
}
function dimensionRankings(aggregate: ReturnType<typeof aggregateMeasurements>, runs: readonly { runId: string; total: ProjectedTotals }[] = []) {
  return {
    agents: rankProjections(aggregate.agents.map(row => rankingRow(row.name, row))),
    providers: rankProjections(aggregate.providers.map(row => rankingRow(row.name, row))),
    models: rankProjections(aggregate.models.map(row => rankingRow(row.model, row))),
    variants: rankProjections(aggregate.variants.map(row => rankingRow(row.name, row))),
    roles: rankProjections(aggregate.roles.map(row => rankingRow(row.name, row))),
    phases: rankProjections(aggregate.dimensions.phases.map(row => rankingRow(row.name, row))),
    runs: rankProjections(runs.map(run => rankingRow(run.runId, run.total))),
  }
}

function projectEvents(root: string, period: Period): { events: LoopEvent[]; errors: string[] } {
  const history = readMeasurements(root, period.from, period.to), seen = new Set<string>()
  const events = [...history.events, ...readEvents(root, EVENT_CAP)].filter(event => {
    const time = Date.parse(event.timestamp)
    if (seen.has(event.id) || !Number.isFinite(time) || time < period.from || time >= period.to) return false
    seen.add(event.id); return true
  }).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  return { events, errors: history.errors }
}

type RunMetadata = { agent?: string; provider?: string; model?: string; variant?: string; role?: string }
function textValue(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value.slice(0, 200) : undefined }
function eventMetadata(event: LoopEvent): RunMetadata {
  const direct = event as unknown as Record<string, unknown>, data = event.data ?? {}
  const calls = Array.isArray(data.calls) ? data.calls.filter(item => item && typeof item === 'object') as Record<string, unknown>[] : []
  const sources = [direct, ...calls, data]
  const first = (keys: string[]) => { for (const source of sources) for (const key of keys) { const value = textValue(source[key]); if (value) return value } return undefined }
  return { agent: first(['agent']), provider: first(['provider']), model: first(['actualModel', 'model']), variant: first(['variant']), role: first(['role']) }
}
function runProjections(events: readonly LoopEvent[], period: Period) {
  const byRun = new Map<string, LoopEvent[]>()
  for (const event of events) byRun.set(event.runId, [...(byRun.get(event.runId) ?? []), event])
  return [...byRun].map(([runId, runEvents]) => {
    const metadata: RunMetadata = {}, phases: string[] = [], timestamps = runEvents.map(event => new Date(event.timestamp).toISOString())
    for (const event of runEvents) {
      const values = eventMetadata(event)
      for (const key of ['agent', 'provider', 'model', 'variant', 'role'] as const) if (metadata[key] === undefined && values[key] !== undefined) metadata[key] = values[key]
      const phase = textValue(event.phase ?? event.data?.phase)
      if (phase && !phases.includes(phase)) phases.push(phase)
    }
    const total = aggregateMeasurements(runEvents, period).total
    return { runId, ...metadata, ...(phases.length ? { phase: phases[phases.length - 1], phases } : {}), timestamps, startedAt: timestamps[0], endedAt: timestamps[timestamps.length - 1], events: runEvents, total, analytics: total }
  }).sort((left, right) => compareNames(left.startedAt, right.startedAt) || compareNames(left.runId, right.runId))
}

export interface ProjectHistory {
  from: string
  to: string
  bucket: Period['bucket']
  timezone: 'UTC'
  events: LoopEvent[]
  runs: ReturnType<typeof runProjections>
  errors: string[]
  coverage: string
}
export function projectHistory(root: string, period: Period, limit: number = DASHBOARD_LIMITS.events): ProjectHistory {
  if (!Number.isInteger(limit) || limit < 1 || limit > DASHBOARD_LIMITS.events) throw Error('Limit must be an integer from 1 to ' + DASHBOARD_LIMITS.events)
  const history = projectEvents(root, period), events = history.events.slice(-limit)
  return { from: new Date(period.from).toISOString(), to: new Date(period.to).toISOString(), bucket: period.bucket, timezone: 'UTC', events, runs: runProjections(events, period), errors: history.errors,
    coverage: 'Recorded measurements only. Earlier unrecorded or expired activity cannot be reconstructed. Usage is assigned to its reporting time; durations to their end time.' }
}

export function workspaceAnalytics(projects: readonly DashboardProjectReference[], period: Period, sort: RankingKey = 'attention') {
  const source: { project: DashboardProjectReference; analytics: ReturnType<typeof aggregateMeasurements> & { errors: string[]; from: string; to: string; bucket: Period['bucket']; timezone: 'UTC'; coverage: string } | null; errors: string[] }[] = []
  const allEvents: LoopEvent[] = []
  for (const project of projects.slice(0, DASHBOARD_LIMITS.projects)) {
    if (project.error || !project.root) { source.push({ project, analytics: null, errors: [project.error ?? 'Project directory is unavailable'] }); continue }
    try {
      const history = projectEvents(project.root, period)
      allEvents.push(...history.events)
      const aggregate = aggregateMeasurements(history.events, period)
      source.push({ project, analytics: { ...aggregate, from: new Date(period.from).toISOString(), to: new Date(period.to).toISOString(), bucket: period.bucket, timezone: 'UTC', errors: history.errors, coverage: 'Recorded measurements only. Earlier unrecorded or expired activity cannot be reconstructed. Usage is assigned to its reporting time; durations to their end time.' }, errors: history.errors })
    } catch (error) { source.push({ project, analytics: null, errors: [(error as Error).message] }) }
  }
  const aggregate = aggregateMeasurements(allEvents, period)
  const runs = runProjections(allEvents, period)
  const projectsWithMetrics = source.map(({ project, analytics, errors }) => {
    const total = analytics?.total
    return { id: project.id, name: project.name, analytics, errors, attention: project.attention ?? ((project.error ? 1 : 0) + (total?.attention ?? 0)), activity: total?.activity ?? null, tokens: total?.tokens.total ?? null, cost: total?.cost.reportedUsd ?? null, acceptance: total?.outcomes.accepted ?? null, costState: total?.costState ?? 'unknown' as CostState }
  })
  const projectRankings = rankProjections(projectsWithMetrics)
  const rankings = { projects: projectRankings, ...dimensionRankings(aggregate, runs) }
  return { ...aggregate, from: new Date(period.from).toISOString(), to: new Date(period.to).toISOString(), bucket: period.bucket, timezone: 'UTC' as const,
    projects: projectRankings[sort], runs, rankings, errors: source.flatMap(row => row.errors) }
}

export function projectAnalytics(root: string, period: Period) {
  const history = projectEvents(root, period)
  const aggregate = aggregateMeasurements(history.events, period)
  const runs = runProjections(history.events, period)
  return { ...aggregate,
    from: new Date(period.from).toISOString(), to: new Date(period.to).toISOString(), bucket: period.bucket, timezone: 'UTC',
    runs, rankings: dimensionRankings(aggregate, runs), errors: history.errors,
    coverage: 'Recorded measurements only. Earlier unrecorded or expired activity cannot be reconstructed. Usage is assigned to its reporting time; durations to their end time.',
  }
}
