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

  it('reserves room for the final summary when earlier errors exhaust the budget', () => {
    const raw = [
      `fatal: ${'x'.repeat(500)}`,
      ...Array.from({ length: 40 }, (_, index) => `error E${String(index).padStart(4, '0')}: noisy failure`),
      'Tests: 40 failed, 2 passed',
    ].join('\n')

    const result = compactCommandOutput(raw, { previewBytes: 128 })

    expect(result.preview).toContain('fatal:')
    expect(result.preview).toContain('Tests: 40 failed, 2 passed')
    expect(Buffer.byteLength(result.preview)).toBeLessThanOrEqual(128)
  })

  it('retains a test summary that precedes ordinary runner footer lines', () => {
    const raw = [
      `fatal: ${'x'.repeat(400)}`,
      ...Array.from({ length: 30 }, (_, index) => `error E${String(index).padStart(4, '0')}: noisy failure`),
      'Tests: 30 failed, 2 passed',
      'Start at 18:00:00',
      'Duration 4.20s',
    ].join('\n')

    const result = compactCommandOutput(raw, { previewBytes: 128 })

    expect(result.preview).toContain('fatal:')
    expect(result.preview).toContain('Tests: 30 failed, 2 passed')
  })

  it('removes OSC, escape, and carriage-return controls from previews', () => {
    const raw = '\u001b]0;secret terminal title\u0007\u001b[31mERROR\u001b[0m:\rspoofed\nsummary'
    const result = compactCommandOutput(raw, { previewBytes: 160 })

    expect(result.preview).not.toContain('secret terminal title')
    expect(result.preview).not.toMatch(/[\u001b\u0007\r]/u)
    expect(result.preview).toContain('ERROR:spoofed')
  })

  it('removes 8-bit C1 OSC and CSI terminal sequences', () => {
    const raw = '\u009d52;c;clipboard payload\u009c\u009b31mERROR\nsummary'
    const result = compactCommandOutput(raw, { previewBytes: 160 })

    expect(result.preview).not.toContain('clipboard payload')
    expect(result.preview).not.toMatch(/[\u0080-\u009f]/u)
    expect(result.preview).toContain('ERROR')
  })

  it('recognizes common Jest, TAP, and assertion failure markers', () => {
    const raw = [
      ...Array.from({ length: 30 }, (_, index) => `setup noise ${index}`),
      'FAIL tests/widget.test.ts',
      'AssertionError: expected true to be false',
      'not ok 1 - widget behavior',
      ...Array.from({ length: 30 }, (_, index) => `teardown noise ${index}`),
    ].join('\n')

    const result = compactCommandOutput(raw, { previewBytes: 220 })

    expect(result.preview).toContain('FAIL tests/widget.test.ts')
    expect(result.preview).toContain('AssertionError')
  })

  it('processes millions of short lines below the capture quota without materializing a line array', () => {
    const noisyLines = 7_000_000
    const raw = `error E1000: first actionable failure\n${'n\n'.repeat(noisyLines)}Tests: 1 failed, 2 passed`

    const result = compactCommandOutput(raw, { previewBytes: 256 })

    expect(Buffer.byteLength(raw)).toBeLessThan(16 * 1024 * 1024)
    expect(result.originalLines).toBe(noisyLines + 2)
    expect(result.preview).toContain('error E1000: first actionable failure')
    expect(result.preview).toContain('Tests: 1 failed, 2 passed')
    expect(Buffer.byteLength(result.preview)).toBeLessThanOrEqual(256)
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
