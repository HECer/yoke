import { expect, it } from 'vitest'
import { makeActionRunner } from '../../src/execution/actions.js'
it('executes an explicit tool task without a model and keeps independent gates external', () => {
  const run = makeActionRunner([{ storyId: 'format', file: process.execPath, args: ['-e', 'process.exit(0)'], timeoutMs: 1000 }], () => { throw new Error('Model should not run') })
  const result = run({ targetDir: process.cwd(), story: { id: 'format', title: 'Format', priority: 1, passes: false, acceptance: [] } })
  expect(result.success).toBe(true); expect(result.tokens?.inputTokens).toBe(0)
})
it('surfaces tool failure instead of silently calling a model', () => {
  const run = makeActionRunner([{ storyId: 'format', file: process.execPath, args: ['-e', 'process.exit(2)'], timeoutMs: 1000 }], () => { throw new Error('Model should not run') })
  expect(run({ targetDir: process.cwd(), story: { id: 'format', title: 'Format', priority: 1, passes: false, acceptance: [] } }).success).toBe(false)
})
