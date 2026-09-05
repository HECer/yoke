import { expect, it } from 'vitest'
import { createContext, runInContext } from 'node:vm'
import { dashboardPage } from '../../src/dashboard/page.js'

it('formats planned task timing and missing token measurements explicitly', () => {
  const html = dashboardPage('a'.repeat(64), 'validNonce')
  const script = /<script[^>]*>([\s\S]*?)<\/script>/u.exec(html)![1]
  const context = createContext({ document: { getElementById: () => ({}) }, fetch: () => new Promise(() => {}) })
  runInContext(script, context)
  expect(runInContext("taskTiming({id:'a'},{available:true,tasks:[{storyId:'a',startMs:60000,endMs:180000}]})", context)).toBe('Predicted 2m · planned start +1m')
  expect(runInContext("taskTiming({id:'a'},{available:false})", context)).toContain('unknown')
  expect(runInContext('tokenText(undefined)', context)).toBe('Unknown')
  expect(runInContext('tokenText(0)', context)).toBe('0')
  expect(runInContext('unknownCallCount({tokens:{calls:[{usageAvailable:true},{usageAvailable:false},{}]}})', context)).toBe(2)
  expect(runInContext('unknownCallCount({measurement:{unmeasuredAttempts:2}})', context)).toBeUndefined()
})
