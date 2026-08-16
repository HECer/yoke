import { describe, expect, it } from 'vitest'
import { compactCommandOutput } from '../../src/output/compact.js'

describe('compactCommandOutput', () => {
  it('prioritizes an early error and retains the final test summary', () => {
    const raw = [
      'starting build',
      'src/app.ts(4,2): error TS2304: Cannot find name widget',
      'context for the compiler error',
      ...Array.from({ length: 80 }, (_, index) => `unchanged progress ${index}`),
      'Tests: 1 failed, 20 passed',
    ].join('\n')

    const result = compactCommandOutput(raw, { previewBytes: 320 })

    expect(result.preview).toContain('error TS2304')
    expect(result.preview).toContain('context for the compiler error')
    expect(result.preview).toContain('Tests: 1 failed, 20 passed')
    expect(result.omitted).toBe(true)
    expect(Buffer.byteLength(result.preview)).toBeLessThanOrEqual(320)
  })

  it('retains warnings when no error exists and removes duplicate selected lines', () => {
    const raw = [
      'warning: deprecated API',
      'warning: deprecated API',
      ...Array.from({ length: 30 }, (_, index) => `line ${index}`),
      'Build completed with 1 warning',
    ].join('\n')

    const result = compactCommandOutput(raw, { previewBytes: 240 })

    expect(result.preview.match(/warning: deprecated API/g)).toHaveLength(1)
    expect(result.preview).toContain('Build completed with 1 warning')
  })

  it('strips ANSI and disallowed control characters from the preview only', () => {
    const raw = '\u001b[31mERROR\u001b[0m:\u0000 broken\nsummary'
    const result = compactCommandOutput(raw, { previewBytes: 128 })

    expect(result.preview).toContain('ERROR: broken')
    expect(result.preview).not.toContain('\u001b[')
    expect(result.preview).not.toContain('\u0000')
  })

  it('enforces the byte budget without splitting UTF-8 sequences', () => {
    const raw = `fatal: ${'🐂'.repeat(80)}\nTests: failed`
    const result = compactCommandOutput(raw, { previewBytes: 96 })

    expect(Buffer.byteLength(result.preview)).toBeLessThanOrEqual(96)
    expect(result.preview).not.toContain('�')
  })

  it('keeps the byte budget after truncating an oversized first signal', () => {
    const raw = [
      `fatal: ${'x'.repeat(500)}`,
      ...Array.from({ length: 30 }, (_, index) => `error E${String(index).padStart(4, '0')}: short`),
    ].join('\n')
    const result = compactCommandOutput(raw, { previewBytes: 128 })
    expect(Buffer.byteLength(result.preview)).toBeLessThanOrEqual(128)
  })

  it('returns empty deterministic metadata for empty input', () => {
    expect(compactCommandOutput('', { previewBytes: 64 })).toEqual({
      preview: '',
      originalBytes: 0,
      originalLines: 0,
      omitted: false,
    })
  })

  it('is deterministic for identical input and options', () => {
    const raw = `panic: boom\n${'noise\n'.repeat(40)}done`
    expect(compactCommandOutput(raw, { previewBytes: 160 })).toEqual(
      compactCommandOutput(raw, { previewBytes: 160 }),
    )
  })
})
