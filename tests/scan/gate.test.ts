import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { designVerifier } from '../../src/scan/gate.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yoke-design-gate-'))
  mkdirSync(join(dir, 'src'), { recursive: true })
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('designVerifier', () => {
  it('passes at the configured score budget and fails above it', () => {
    writeFileSync(join(dir, 'src', 'App.tsx'), '<main style={{ color: "#7c3aed" }}>Hello</main>')

    expect(designVerifier(2)(dir)).toMatchObject({ passed: true })
    expect(designVerifier(1)(dir)).toMatchObject({ passed: false, summary: expect.stringContaining('ai-purple') })
  })

  it('bounds failure preview and writes full findings through the artifact contract', () => {
    writeFileSync(join(dir, 'src', 'App.tsx'), Array.from({ length: 30 }, (_, index) => `<div style={{ color: "#7c3aed" }}>${index}</div>`).join('\n'))
    const artifactWriter = vi.fn(() => ({
      relativePath: '.yoke/artifacts/S1/design-test.log', bytes: 999, sha256: 'abc',
      marker: '[full output: .yoke/artifacts/S1/design-test.log | 999 bytes | sha256:abc]',
    }))

    const result = designVerifier(0, {
      policy: { previewBytes: 80, artifactThresholdBytes: 90 },
      artifactWriter,
    })(dir)

    expect(result.passed).toBe(false)
    expect(result.summary.length).toBeLessThan(500)
    expect(result.summary).toContain('[full output: .yoke/artifacts/S1/design-test.log')
    expect(artifactWriter).toHaveBeenCalledOnce()
    expect(artifactWriter.mock.calls[0]?.[2]).toMatchObject({ phase: 'design' })
  })
})
