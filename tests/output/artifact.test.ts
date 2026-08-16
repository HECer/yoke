import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
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

  it('extends the digest prefix when a shorter path contains different content', () => {
    const raw = 'collision-safe evidence'
    const sha256 = createHash('sha256').update(raw).digest('hex')
    const artifactDir = join(dir, '.yoke', 'artifacts', 'session')
    mkdirSync(artifactDir, { recursive: true })
    writeFileSync(join(artifactDir, `verify-${sha256.slice(0, 12)}.log`), 'different content')

    const artifact = writeOutputArtifact(dir, raw, { phase: 'verify' })

    expect(artifact.relativePath).toMatch(/verify-[a-f0-9]{20}\.log$/)
    expect(readFileSync(join(dir, ...artifact.relativePath.split('/')), 'utf8')).toBe(raw)
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

  it('refuses an artifact root symlink that leaves the project', () => {
    const outside = mkdtempSync(join(tmpdir(), 'yoke-output-outside-'))
    const link = join(dir, '.yoke', 'artifacts')
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    try {
      expect(() => writeOutputArtifact(dir, 'do not redirect', { phase: 'verify' })).toThrow(/artifact root|escaped/i)
    } finally {
      unlinkSync(link)
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('rejects a symlinked .yoke parent before creating directories outside the project', () => {
    const outside = mkdtempSync(join(tmpdir(), 'yoke-output-parent-outside-'))
    const link = join(dir, '.yoke')
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    try {
      expect(() => writeOutputArtifact(dir, 'do not redirect', { phase: 'verify' })).toThrow(/artifact root|escaped|symlink/i)
      expect(existsSync(join(outside, 'artifacts'))).toBe(false)
    } finally {
      unlinkSync(link)
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('refuses a symlinked story directory that leaves the artifact root', () => {
    const outside = mkdtempSync(join(tmpdir(), 'yoke-output-story-outside-'))
    const artifactRoot = join(dir, '.yoke', 'artifacts')
    mkdirSync(artifactRoot, { recursive: true })
    const link = join(artifactRoot, 'STORY-1')
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    try {
      expect(() => writeOutputArtifact(dir, 'do not redirect', { phase: 'verify', storyId: 'STORY-1' })).toThrow(/escaped/i)
      expect(readdirSync(outside)).toEqual([])
    } finally {
      unlinkSync(link)
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('fails closed when every digest path contains mismatched content', () => {
    const raw = 'authentic output'
    const sha256 = createHash('sha256').update(raw).digest('hex')
    const artifactDir = join(dir, '.yoke', 'artifacts', 'session')
    mkdirSync(artifactDir, { recursive: true })
    for (const digestLength of [12, 20, 28, 36, 44, 52, 60, 64]) {
      writeFileSync(join(artifactDir, `verify-${sha256.slice(0, digestLength)}.log`), `mismatch-${digestLength}`)
    }

    expect(() => writeOutputArtifact(dir, raw, { phase: 'verify' })).toThrow(/mismatched content/i)
  })

  it('creates artifact files with user-only mode on non-Windows systems', () => {
    const artifact = writeOutputArtifact(dir, 'private', { phase: 'audit' })
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, ...artifact.relativePath.split('/'))).mode & 0o777).toBe(0o600)
    }
  })

  it('restores user-only mode when reusing an existing artifact on non-Windows systems', () => {
    const first = writeOutputArtifact(dir, 'private reuse', { phase: 'audit' })
    const file = join(dir, ...first.relativePath.split('/'))
    if (process.platform !== 'win32') {
      chmodSync(file, 0o666)
      writeOutputArtifact(dir, 'private reuse', { phase: 'audit' })
      expect(statSync(file).mode & 0o777).toBe(0o600)
    }
  })
})
