import { describe, expect, it } from 'vitest'
import { processIncarnation } from '../../src/agents/process-incarnation.js'

describe('processIncarnation', () => {
  it('queries Windows creation time through a fixed argv command and PID argument', () => {
    const calls: Array<readonly [string, readonly string[]]> = []

    const incarnation = processIncarnation(4242, 'win32', (command, args) => {
      calls.push([command, args])
      return '20260814123456.000000+000'
    })

    expect(incarnation).toBe('win32:20260814123456.000000+000')
    expect(calls).toEqual([['powershell.exe', expect.arrayContaining(['-NoProfile', '-NonInteractive', '-Command'])]])
  })
})
