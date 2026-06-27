import { describe, it, expect } from 'vitest'
import { hasWsl } from '../../src/retrofit/wsl.js'

describe('hasWsl', () => {
  it('returns a boolean and never throws', () => {
    expect(typeof hasWsl()).toBe('boolean')
  })

  it('is false on non-win32 platforms', () => {
    // hasWsl() short-circuits to false unless process.platform === 'win32'
    if (process.platform !== 'win32') {
      expect(hasWsl()).toBe(false)
    } else {
      expect(typeof hasWsl()).toBe('boolean')
    }
  })
})
