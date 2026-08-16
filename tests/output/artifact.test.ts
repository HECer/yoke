import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { writeOutputArtifact } from '../../src/output/artifact.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-output-artifact-')) })
afterEach(() => {
  try { chmodSync(join(dir, '.yoke', 'artifacts'), 0o700) } catch { /* absent */ }
  rmSync(dir, { recursive: true, force: true })
})

describe('writeOutputArtifact', () => {
  it('writes exact bytes and returns a verifiable content identity', () => {
    const raw = '=== stdout ===\nhello\r\n=== stderr ===\nboom\n'
    const artifact = writeOutputArtifact(dir, raw, { phase: 'verify', storyId: 'STORY-1' })

    expect(readFileSync(join(dir, ...artifact.relativePath.split('/')), 'utf8')).toBe(raw)
    expect(artifact.bytes).toBe(Buffer.byteLength(raw))
    expect(artifact.sha256).toBe(createHash('sha256').update(raw).digest('hex'))
    expect(artifact.relativePath).toMatch(/^\.yoke\/artifacts\/STORY-1\/verify-[a-f0-9]{12}\.log$/)
    expect(artifact.marker).toContain(artifact.relativePath)
    expect(artifact.marker).toContain(artifact.sha256)
  })

  it('returns the same path and metadata for repeated identical evidence', () => {
    const first = writeOutputArtifact(dir, 'same evidence', { phase: 'perf', storyId: 'S-2' })
    const second = writeOutputArtifact(dir, 'same evidence', { phase: 'perf', storyId: 'S-2' })
    expect(second).toEqual(first)
  })

  it('sanitizes story ids and cannot escape the fixed artifact root', () => {
    const artifact = writeOutputArtifact(dir, 'evidence', { phase: 'criterion', storyId: '../STORY 1/../../secret' })
    expect(artifact.relativePath).toMatch(/^\.yoke\/artifacts\/STORY-1-..-..-secret\/criterion-/)
    expect(artifact.relativePath).not.toContain('\\')
    expect(artifact.relativePath).not.toContain('/../')
  })

  it('falls back to a stable session label for an empty story id', () => {
    expect(writeOutputArtifact(dir, 'x', { phase: 'completion', storyId: '' }).relativePath)
      .toMatch(/^\.yoke\/artifacts\/session\/completion-/)
  })

  it('creates artifact files with user-only mode on non-Windows systems', () => {
    const artifact = writeOutputArtifact(dir, 'private', { phase: 'audit' })
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, ...artifact.relativePath.split('/'))).mode & 0o777).toBe(0o600)
    }
  })
})
