import { randomUUID } from 'node:crypto'
import type { ModelSelection } from '../agents/types.js'
import type { Agent } from '../retrofit/config.js'
import { parseProviderTelemetry } from '../agents/telemetry.js'
import type { AgentResult, Invocation } from '../loop/runner.js'
import { appendEvent } from './events.js'
import { providerTelemetryUsage } from './usage.js'

/** A single invocation boundary, including failures and injected runner seams. */
export function measureInvocation<T extends AgentResult>(options: {
  root: string
  agent: Agent
  role: string
  storyId?: string
  runId?: string
  parentCallId?: string
  selection?: ModelSelection
  invocation: Invocation
  execute: (invocation: Invocation) => T
}): T {
  const started = Date.now(), callId = randomUUID(), runId = options.runId ?? randomUUID()
  let result: T | undefined
  let failure: unknown
  const base = { runId, storyId: options.storyId, attemptId: callId, agent: options.agent, role: options.role }
  appendEvent(options.root, { ...base, timestamp: new Date(started).toISOString(), type: 'status', data: { callId, parentCallId: options.parentCallId, state: 'started' } })
  try { result = options.execute(options.invocation); return result }
  catch (error) { failure = error; throw error }
  finally {
    let salvaged: AgentResult['tokens']
    try {
      const stdout = failure && typeof failure === 'object' && 'stdout' in failure ? failure.stdout : undefined
      salvaged = stdout == null ? undefined : providerTelemetryUsage(parseProviderTelemetry(options.agent, String(stdout).split(/\r?\n/u)))
    } catch { /* Failed measurement must not replace the original provider error. */ }
    const usage = result?.tokens ?? salvaged
    const complete = usage !== undefined && usage.measurementComplete !== false
    const durationMs = Date.now() - started
    appendEvent(options.root, {
      ...base, timestamp: new Date().toISOString(), type: 'tokens', durationMs, outcome: result?.success ? 'succeeded' : 'failed',
      data: {
        ...usage, callId, parentCallId: options.parentCallId,
        provider: options.agent, role: options.role,
        requestedProvider: options.selection?.provider, requestedModel: options.selection?.model,
        requestedReasoningEffort: options.selection?.reasoningEffort, requestedVariant: options.selection?.variant,
        actualModel: usage?.model, measurementComplete: complete, usageAvailable: complete,
        costMeasurementComplete: usage?.costMeasurementComplete ?? (typeof usage?.totalCostUsd === 'number'),
      },
    })
  }
}
