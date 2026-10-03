export const requiredResultFields = [
  'schemaVersion', 'fixtureVersion', 'runner', 'sampleLabel', 'permissionProfile',
  'usageAvailable', 'modelAvailable', 'verdict', 'conflicts', 'wallClockMs',
  'iterations', 'finalTestsPass',
]

export function validateResult(result) {
  const missing = requiredResultFields.filter(key => !(key in result))
  if (missing.length) throw new Error(`benchmark result missing: ${missing.join(', ')}`)
  if (!['completed', 'blocked', 'unavailable', 'auth-failed'].includes(result.verdict)) throw new Error(`invalid verdict: ${result.verdict}`)
  return result
}

// Comparison manifests are separate from the historical individual-run schema above.
// A "verified" manifest describes comparable recorded conditions, not a causal or
// statistically conclusive performance result.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const nonempty = value => typeof value === 'string' && value.trim().length > 0
const boolean = value => typeof value === 'boolean'
const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const positiveInteger = value => Number.isSafeInteger(value) && value > 0

export const comparisonContextFields = {
  'source.version': nonempty,
  'source.commit': value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value),
  'source.dirty': boolean,
  'source.buildDigest': sha256,
  'source.stable': value => value === true,
  'fixture.id': nonempty,
  'fixture.seedDigest': sha256,
  'fixture.acceptanceDigest': sha256,
  'fixture.requirementsDigest': sha256,
  'execution.provider': nonempty,
  'execution.requestedModel': nonempty,
  'execution.actualModels': value => Array.isArray(value) && value.length > 0 && value.every(nonempty) && new Set(value).size === value.length,
  'execution.effort': nonempty,
  'execution.routing': boolean,
  'execution.nativeMultiAgent': boolean,
  'execution.nativeGoal': boolean,
  'execution.parallel': positiveInteger,
  'execution.workflow': nonempty,
  'execution.promptDigest': sha256,
  'execution.promptScope': value => ['provider-prompt', 'workflow-input-bundle'].includes(value),
  'startup.permissionProfile': value => ['safe', 'read-only', 'unsafe'].includes(value),
  'startup.bare': boolean,
  'startup.ignoreRules': boolean,
  'startup.commitPolicy': nonempty,
  'startup.isolation': nonempty,
  'startup.timeoutPolicy': nonempty,
  'startup.userStatePolicy': nonempty,
  'environment.platform': nonempty,
  'environment.arch': nonempty,
  'environment.nodeVersion': nonempty,
  'environment.providerVersion': nonempty,
  'environment.hostDigest': sha256,
  'environment.hostLoad': value => ['uncontrolled', 'isolated'].includes(value),
  'environment.skillsPlugins': value => ['not-audited', 'audited'].includes(value),
}

export const allowedComparisonVariables = Object.keys(comparisonContextFields)
  .filter(field => !field.startsWith('fixture.') && field !== 'source.stable')

export function comparisonValue(context, field) {
  return field.split('.').reduce((value, key) => record(value) ? value[key] : undefined, context)
}

export function stableComparisonJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableComparisonJson).join(',') + ']'
  if (record(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableComparisonJson(value[key])).join(',') + '}'
  return JSON.stringify(value)
}

export function comparisonManifestIssues(manifest) {
  if (!record(manifest)) return ['Missing versioned comparison manifest']
  const issues = []
  if (manifest.schemaVersion !== 1) issues.push('Unsupported comparison manifest version')
  if (!nonempty(manifest.id)) issues.push('Missing comparison identity')
  if (!['workflow', 'controlled'].includes(manifest.kind)) issues.push('Unknown comparison kind')
  if (!Array.isArray(manifest.arms) || manifest.arms.length < 2 || !manifest.arms.every(nonempty) || new Set(manifest.arms).size !== manifest.arms.length) issues.push('Declare at least two distinct comparison arms')
  if (!positiveInteger(manifest.repeats)) issues.push('Declare the planned number of paired repeats')
  if (!Array.isArray(manifest.allowedDifferences)) issues.push('Declare allowed differences explicitly, including an empty list when appropriate')
  else {
    const fields = new Set()
    for (const difference of manifest.allowedDifferences) {
      if (!record(difference) || !allowedComparisonVariables.includes(difference.field) || !nonempty(difference.reason)) {
        issues.push('Invalid comparison variable or missing rationale')
        continue
      }
      if (fields.has(difference.field)) issues.push('Duplicate comparison variable: ' + difference.field)
      fields.add(difference.field)
    }
  }
  return issues
}

export function comparisonContextIssues(context) {
  if (!record(context)) return ['Missing per-run comparison context']
  const issues = []
  for (const [field, validate] of Object.entries(comparisonContextFields)) {
    if (!validate(comparisonValue(context, field))) issues.push('Missing, unknown or invalid condition: ' + field)
  }
  // Refuse silently ignored startup/source conditions introduced by a future writer.
  for (const [section, fields] of Object.entries(context)) {
    if (!record(fields)) { issues.push('Invalid context section: ' + section); continue }
    for (const field of Object.keys(fields)) {
      if (!(section + '.' + field in comparisonContextFields)) issues.push('Unknown comparison condition: ' + section + '.' + field)
    }
  }
  return issues
}

export function assessComparison(manifests, runs) {
  const manifest = manifests[0]
  let reasons = manifests.flatMap(comparisonManifestIssues)
  if (reasons.length) return { status: 'unverified', reasons: [...new Set(reasons)] }
  if (manifests.some(value => stableComparisonJson(value) !== stableComparisonJson(manifest))) return { status: 'incompatible', reasons: ['Comparison manifests differ for the same identity'] }
  reasons = runs.flatMap(run => comparisonContextIssues(run.context).map(issue => run.arm + ': ' + issue))
  for (const run of runs) {
    if (!manifest.arms.includes(run.arm) || !positiveInteger(run.repeat) || run.repeat > manifest.repeats) reasons.push('Unexpected arm or repeat')
    if (run.fixture !== run.context?.fixture?.id) reasons.push('Fixture label disagrees with measured context')
    if (typeof run.accepted !== 'boolean') reasons.push('Missing acceptance outcome')
  }
  if (reasons.length) return { status: 'unverified', reasons: [...new Set(reasons)] }
  const keys = runs.map(run => run.arm + ':' + run.repeat)
  if (new Set(keys).size !== keys.length) return { status: 'incompatible', reasons: ['Duplicate arm/repeat measurements'] }
  const permitted = new Set(manifest.allowedDifferences.map(value => value.field))
  for (const field of Object.keys(comparisonContextFields)) {
    const valueOf = run => {
      const value = comparisonValue(run.context, field)
      return stableComparisonJson(field === 'execution.actualModels' ? [...value].sort() : value)
    }
    for (const arm of manifest.arms) {
      if (new Set(runs.filter(run => run.arm === arm).map(valueOf)).size > 1) reasons.push('Conditions changed within arm ' + arm + ': ' + field)
    }
    if (!permitted.has(field) && new Set(runs.map(valueOf)).size > 1) reasons.push('Undeclared difference between arms: ' + field)
  }
  if (reasons.length) return { status: 'incompatible', reasons: [...new Set(reasons)] }
  if (runs.length !== manifest.arms.length * manifest.repeats) return { status: 'incomplete', reasons: ['Not all declared paired runs are present'] }
  if (runs.some(run => !run.accepted)) return { status: 'acceptance-failed', reasons: ['At least one arm failed immutable acceptance; failed elapsed time is not a speedup'] }
  if (runs.some(run => run.usage?.measurementComplete === false || ['inputTokens', 'cachedInputTokens', 'outputTokens'].some(field => !Number.isFinite(run.usage?.[field]) || run.usage[field] < 0))) {
    return { status: 'unverified', reasons: ['Incomplete token telemetry; retain diagnostic timings without an efficiency comparison'] }
  }
  return { status: 'verified', reasons: [] }
}
