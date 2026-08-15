import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectCandidateArtifacts } from '../../src/quality/artifacts.js'

const projectDir = resolve('quality-app')
const proofDir = join(projectDir, '.yoke', 'proof')
const home = new TextEncoder().encode('home screenshot')
const settings = new TextEncoder().encode('settings screenshot')
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

describe('collectCandidateArtifacts', () => {
  it('collects screenshots only beneath proof and returns SHA-256 digests in stable order', async () => {
    const homePath = join(proofDir, 'STORY-1', 'home.png')
    const settingsPath = join(proofDir, 'STORY-1', 'settings.png')
    const result = await collectCandidateArtifacts(
      { projectDir, candidate: { kind: 'screenshots', paths: ['.yoke/proof/STORY-1/settings.png', '.yoke/proof/STORY-1/home.png'] } },
      {
        readFile: path => path === homePath ? home : path === settingsPath ? settings : null,
        commandOutput: () => home,
        benchmark: () => settings,
      },
    )

    expect(result).toEqual({
      kind: 'collected',
      artifacts: [
        { kind: 'screenshot', path: homePath, bytes: home.byteLength, digest: digest(home) },
        { kind: 'screenshot', path: settingsPath, bytes: settings.byteLength, digest: digest(settings) },
      ].sort((left, right) => left.digest.localeCompare(right.digest)),
      digests: [digest(home), digest(settings)].sort(),
    })
  })

  it('collects project files and injected command or benchmark output', async () => {
    const reportPath = join(projectDir, 'reports', 'quality.json')
    const commandBytes = new TextEncoder().encode('command evidence')
    const benchmarkBytes = new TextEncoder().encode('benchmark evidence')
    const adapters = {
      readFile: (path: string) => path === reportPath ? home : null,
      commandOutput: () => commandBytes,
      benchmark: () => benchmarkBytes,
    }

    const file = await collectCandidateArtifacts(
      { projectDir, candidate: { kind: 'files', paths: ['reports/quality.json'] } },
      adapters,
    )
    const command = await collectCandidateArtifacts(
      { projectDir, candidate: { kind: 'command-output', command: 'capture-quality' } },
      adapters,
    )
    const benchmark = await collectCandidateArtifacts(
      { projectDir, candidate: { kind: 'benchmark', command: 'benchmark-quality' } },
      adapters,
    )

    expect(file).toMatchObject({ kind: 'collected', artifacts: [{ kind: 'file', path: reportPath, digest: digest(home) }] })
    expect(command).toMatchObject({ kind: 'collected', artifacts: [{ kind: 'command-output', digest: digest(commandBytes) }] })
    expect(benchmark).toMatchObject({ kind: 'collected', artifacts: [{ kind: 'benchmark', digest: digest(benchmarkBytes) }] })
  })

  it('rejects traversal, proof escapes, and missing artifacts before accepting a candidate', async () => {
    let reads = 0
    const adapters = {
      readFile: () => { reads += 1; return null },
      commandOutput: () => home,
      benchmark: () => settings,
    }

    const traversal = await collectCandidateArtifacts(
      { projectDir, candidate: { kind: 'files', paths: ['../secret.txt'] } },
      adapters,
    )
    const proofEscape = await collectCandidateArtifacts(
      { projectDir, candidate: { kind: 'screenshots', paths: ['reports/home.png'] } },
      adapters,
    )
    const missing = await collectCandidateArtifacts(
      { projectDir, candidate: { kind: 'files', paths: ['reports/missing.json'] } },
      adapters,
    )

    expect(traversal).toEqual({ kind: 'rejected', reason: 'path-traversal' })
    expect(proofEscape).toEqual({ kind: 'rejected', reason: 'outside-proof' })
    expect(missing).toEqual({ kind: 'rejected', reason: 'missing' })
    expect(reads).toBe(1)
  })

  it('rejects shell control in candidate commands before invoking an adapter', () => {
    let commands = 0

    const result = collectCandidateArtifacts(
      { projectDir, candidate: { kind: 'command-output', command: 'capture-quality; remove-files' } },
      {
        readFile: () => null,
        commandOutput: () => { commands += 1; return home },
        benchmark: () => settings,
      },
    )

    expect(result).toEqual({ kind: 'rejected', reason: 'shell-control' })
    expect(commands).toBe(0)
  })
})
