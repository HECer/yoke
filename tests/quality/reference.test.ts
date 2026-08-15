import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { acquireReference } from '../../src/quality/reference.js'

const projectDir = 'C:\\workspace\\quality-app'
const referenceBytes = new TextEncoder().encode('trusted design reference')
const referenceDigest = createHash('sha256').update(referenceBytes).digest('hex')

describe('acquireReference', () => {
  it('persists inert file bytes and complete provenance beneath the reference digest directory', async () => {
    const writes: Array<{ path: string; bytes: Uint8Array }> = []
    const directories: string[] = []
    const acquiredAt = '2026-08-14T07:00:00.000Z'
    const provenance = {
      kind: 'file',
      source: 'designs/reference.png',
      acquiredAt,
      contentType: 'image/png',
      byteSize: referenceBytes.byteLength,
      sha256: referenceDigest,
      adapterVersion: 'test-adapter/1',
      parameters: { viewport: '1440x900', normalization: true },
    }
    const storagePath = join(projectDir, '.yoke', 'references', referenceDigest)

    const result = await acquireReference(
      {
        projectDir,
        now: () => acquiredAt,
        reference: { name: 'landing page', kind: 'file', source: 'designs/reference.png', digest: `sha256:${referenceDigest.toUpperCase()}` },
      },
      {
        version: 'test-adapter/1',
        readFile: path => path === join(projectDir, 'designs', 'reference.png')
          ? { bytes: referenceBytes, contentType: 'image/png', parameters: { viewport: '1440x900', normalization: true } }
          : null,
        requestUrl: () => ({ status: 200, body: referenceBytes }),
        resolveHostname: () => ['8.8.8.8'],
        runCommand: () => referenceBytes,
        mkdir: path => { directories.push(path) },
        writeFile: (path, bytes) => { writes.push({ path, bytes }) },
      },
    )

    expect(result).toEqual({
      kind: 'acquired',
      artifact: {
        name: 'landing page',
        digest: referenceDigest,
        bytes: referenceBytes.byteLength,
        storagePath,
        provenance,
      },
    })
    expect(directories).toEqual([storagePath])
    expect(writes).toEqual([
      { path: join(storagePath, 'content'), bytes: referenceBytes },
      { path: join(storagePath, 'provenance.json'), bytes: new TextEncoder().encode(JSON.stringify(provenance)) },
    ])
  })

  it('rejects a declared digest that does not match acquired inert bytes before persisting', async () => {
    let writes = 0

    const result = await acquireReference(
      { projectDir, reference: { name: 'wrong digest', kind: 'command', source: 'capture-reference', digest: 'sha256:not-the-content' } },
      {
        readFile: () => null,
        requestUrl: () => ({ status: 200, body: referenceBytes }),
        resolveHostname: () => ['8.8.8.8'],
        runCommand: () => referenceBytes,
        mkdir: () => undefined,
        writeFile: () => { writes += 1 },
      },
    )

    expect(result).toEqual({ kind: 'rejected', reason: 'digest-mismatch' })
    expect(writes).toBe(0)
  })

  it('follows bounded public HTTP redirects through the injected adapter', async () => {
    const requests: string[] = []
    const approvedAddresses: readonly string[][] = []

    const result = await acquireReference(
      {
        projectDir,
        reference: { name: 'landing page', kind: 'url', source: 'https://public.example/start' },
      },
      {
        readFile: () => null,
        requestUrl: (url, addresses) => {
          requests.push(url)
          approvedAddresses.push([...addresses])
          return requests.length === 1
            ? { status: 302, location: '/final.png', body: new Uint8Array() }
            : { status: 200, body: referenceBytes }
        },
        resolveHostname: () => ['8.8.8.8'],
        runCommand: () => referenceBytes,
        mkdir: () => undefined,
        writeFile: () => undefined,
      },
    )

    expect(result.kind).toBe('acquired')
    expect(requests).toEqual(['https://public.example/start', 'https://public.example/final.png'])
    expect(approvedAddresses).toEqual([['8.8.8.8'], ['8.8.8.8']])
  })

  it('converts active HTML content from URL references into inert text', () => {
    const result = acquireReference(
      { projectDir, reference: { name: 'page', kind: 'url', source: 'https://public.example/page' } },
      {
        readFile: () => null,
        requestUrl: () => ({ status: 200, body: { bytes: referenceBytes, contentType: 'text/html' } }),
        resolveHostname: () => ['8.8.8.8'],
        runCommand: () => referenceBytes,
        mkdir: () => undefined,
        writeFile: () => undefined,
      },
    )

    expect(result).toMatchObject({ kind: 'acquired', artifact: { provenance: { contentType: 'text/plain' } } })
  })

  it('rejects a file path that traverses outside the project before reading or writing', async () => {
    let reads = 0

    const result = await acquireReference(
      {
        projectDir,
        reference: { name: 'escape', kind: 'file', source: '../outside.png' },
      },
      {
        readFile: () => {
          reads += 1
          return referenceBytes
        },
        requestUrl: () => ({ status: 200, body: referenceBytes }),
        resolveHostname: () => ['8.8.8.8'],
        runCommand: () => referenceBytes,
        mkdir: () => undefined,
        writeFile: () => undefined,
      },
    )

    expect(result).toEqual({ kind: 'rejected', reason: 'path-traversal' })
    expect(reads).toBe(0)
  })

  it('rejects loopback URLs unless explicit local access is allowed', async () => {
    let requests = 0
    const adapters = {
      readFile: () => null,
      requestUrl: () => {
        requests += 1
        return { status: 200, body: referenceBytes }
      },
      resolveHostname: () => ['127.0.0.1'],
      runCommand: () => referenceBytes,
      mkdir: () => undefined,
      writeFile: () => undefined,
    }

    const denied = await acquireReference(
      { projectDir, reference: { name: 'local', kind: 'url', source: 'http://127.0.0.1/secret' } },
      adapters,
    )
    const allowed = await acquireReference(
      { projectDir, allowLocal: true, reference: { name: 'local', kind: 'url', source: 'http://127.0.0.1/secret' } },
      adapters,
    )

    expect(denied).toEqual({ kind: 'rejected', reason: 'private-address' })
    expect(allowed.kind).toBe('acquired')
    expect(requests).toBe(1)
  })

  it('rejects unsupported URL protocols and redirect overflows', async () => {
    const unsupported = await acquireReference(
      { projectDir, reference: { name: 'ftp', kind: 'url', source: 'ftp://public.example/reference.png' } },
      {
        readFile: () => null,
        requestUrl: () => ({ status: 200, body: referenceBytes }),
        resolveHostname: () => ['8.8.8.8'],
        runCommand: () => referenceBytes,
        mkdir: () => undefined,
        writeFile: () => undefined,
      },
    )
    const overflow = await acquireReference(
      { projectDir, maxRedirects: 1, reference: { name: 'redirecting', kind: 'url', source: 'https://public.example/one' } },
      {
        readFile: () => null,
        requestUrl: () => ({ status: 302, location: '/again', body: new Uint8Array() }),
        resolveHostname: () => ['8.8.8.8'],
        runCommand: () => referenceBytes,
        mkdir: () => undefined,
        writeFile: () => undefined,
      },
    )

    expect(unsupported).toEqual({ kind: 'rejected', reason: 'unsupported-protocol' })
    expect(overflow).toEqual({ kind: 'rejected', reason: 'redirect-overflow' })
  })

  it('rejects oversized response bytes before persisting them', async () => {
    let writes = 0

    const result = await acquireReference(
      {
        projectDir,
        maxBytes: referenceBytes.byteLength - 1,
        reference: { name: 'large', kind: 'command', source: 'capture-reference' },
      },
      {
        readFile: () => null,
        requestUrl: () => ({ status: 200, body: referenceBytes }),
        resolveHostname: () => ['8.8.8.8'],
        runCommand: () => referenceBytes,
        mkdir: () => undefined,
        writeFile: () => { writes += 1 },
      },
    )

    expect(result).toEqual({ kind: 'rejected', reason: 'oversize' })
    expect(writes).toBe(0)
  })

  it('captures command bytes only when the command has no shell-control operator', async () => {
    let commands = 0
    const adapters = {
      readFile: () => null,
      requestUrl: () => ({ status: 200, body: referenceBytes }),
      resolveHostname: () => ['8.8.8.8'],
      runCommand: () => {
        commands += 1
        return referenceBytes
      },
      mkdir: () => undefined,
      writeFile: () => undefined,
    }

    const acquired = await acquireReference(
      { projectDir, reference: { name: 'capture', kind: 'command', source: 'capture-reference --format=png' } },
      adapters,
    )
    const rejected = await acquireReference(
      { projectDir, reference: { name: 'unsafe', kind: 'command', source: 'capture-reference; rm -rf /' } },
      adapters,
    )

    expect(acquired.kind).toBe('acquired')
    expect(rejected).toEqual({ kind: 'rejected', reason: 'shell-control' })
    expect(commands).toBe(1)
  })
})
