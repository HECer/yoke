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
