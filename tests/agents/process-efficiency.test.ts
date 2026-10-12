import { afterEach, describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startProviderProcess as spawnProvider, type ProviderProcessHandle } from '../../src/agents/process.js'

const handles: ProviderProcessHandle[] = []
const roots: string[] = []
const startProviderProcess: typeof spawnProvider = (...args) => {
  const handle = spawnProvider(...args)
  handles.push(handle)
  return handle
}
afterEach(async () => {
  const pending = handles.splice(0)
  pending.forEach(handle => handle.cancel('test teardown'))
  await Promise.allSettled(pending.map(handle => handle.completion))
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }))
})

async function project(run: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'yoke-efficiency-'))
  roots.push(root)
  mkdirSync(join(root, '.yoke'))
  try { await run(root) } finally { rmSync(root, { recursive: true, force: true }) }
}
const invocation = (cwd: string, script: string) => ({ cwd, command: process.execPath, args: ['--eval', script], input: 'a billable prompt' })

describe('provider dispatch and termination efficiency', { timeout: 20_000 }, () => {
  it('returns a typed preflight failure when initial supervision storage is unavailable', async () => project(async root => {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(root, '.yoke', 'supervision'), 'blocked')
    const handle = startProviderProcess('codex', invocation(root, 'process.stdin.resume()'))
    assert.equal(handle.pid, undefined)
    const result = await handle.completion
    assert.equal(result.kind, 'spawn-failed')
    assert.equal(result.failure?.modelExecution, 'not-started')
    assert.equal(result.telemetry.tokens?.inputTokens, 0)
  }))
  it('does not send a prompt when preparation aborts during ownership publication', async () => project(async root => {
    const abort = new AbortController()
    const marker = join(root, 'prompt-received')
    const script = `process.stdin.on('data',()=>require('fs').writeFileSync(${JSON.stringify(marker)},'received')); setInterval(()=>{},1000)`
    const handle = startProviderProcess('codex', invocation(root, script), {
      signal: abort.signal, terminationGraceMs: 10,
      recordAdapter: { publish: () => { abort.abort('preparation cancelled') }, remove: () => {} },
    })
    try {
      const result = await handle.completion
      assert.equal(result.kind, 'cancelled')
      assert.equal(existsSync(marker), false)
    } finally { handle.cancel('test cleanup') }
  }))
  it('does not spawn or send input for an already-aborted request', async () => project(async root => {
    const abort = new AbortController(); abort.abort('cancelled before dispatch')
    let published = false
    const handle = startProviderProcess('codex', invocation(root, 'process.stdin.resume()'), {
      signal: abort.signal, recordAdapter: { publish: () => { published = true }, remove: () => {} },
    })
    const result = await handle.completion
    assert.equal(handle.pid, undefined)
    assert.equal(published, false)
    assert.equal(result.kind, 'cancelled')
    assert.deepEqual(result.telemetry, { usageAvailable: true, tokens: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 } })
    assert.equal(handle.cancel('again'), false)
  }))
  it('rejects invalid output limits before a provider process is created', async () => project(async root => {
    let published = false
    const handle = startProviderProcess('codex', invocation(root, 'process.stdin.resume()'), {
      outputLimitBytes: -1, recordAdapter: { publish: () => { published = true }, remove: () => {} },
    })
    assert.equal(handle.pid, undefined)
    assert.equal(published, false)
    assert.equal((await handle.completion).kind, 'spawn-failed')
  }))
  it('preserves Unicode split across separate stdout and stderr pipe writes', async () => project(async root => {
    const script = `const bytes=Buffer.from('🌍ä日本'); let i=0; const timer=setInterval(()=>{ if(i===bytes.length){ clearInterval(timer); return } process.stdout.write(bytes.subarray(i,i+1)); process.stderr.write(bytes.subarray(i,i+1)); i++ },5)`
    const result = await startProviderProcess('codex', invocation(root, script)).completion
    assert.equal(result.kind, 'succeeded')
    assert.equal(result.stdout, '🌍ä日本')
    assert.equal(result.stderr, '🌍ä日本')
  }))
  it('settles exactly once with measured usage when record cleanup throws', async () => project(async root => {
    const script = `process.stdout.write('中文\\n{"type":"turn.completed","usage":{"input_tokens":9,"output_tokens":2}}\\n')`
    let removed = 0
    const handle = startProviderProcess('codex', invocation(root, script), {
      recordAdapter: { publish: () => {}, remove: () => { removed++; throw new Error('cleanup storage offline') } },
    })
    const result = await handle.completion
    assert.equal(result.kind, 'spawn-failed')
    assert.ok(result.kind === 'spawn-failed' && result.error.includes('cleanup storage offline'))
    assert.equal(result.telemetry.tokens?.inputTokens, 9)
    assert.equal(result.failure?.modelExecution, 'started')
    assert.equal(await handle.completion, result)
    assert.equal(removed, 1)
    assert.equal(handle.cancel('after completion'), false)
  }))
  it('still measures tokens when console retention is explicitly disabled', async () => project(async root => {
    const script = `process.stdout.write('{"type":"turn.completed","usage":{"input_tokens":9,"output_tokens":2}}\\n')`
    const result = await startProviderProcess('codex', invocation(root, script), { outputLimitBytes: 0 }).completion
    assert.equal(result.kind, 'succeeded')
    assert.equal(result.stdout, '')
    assert.equal(result.stdoutTruncated, true)
    assert.equal(result.telemetry.tokens?.inputTokens, 9)
  }))
  it('terminates instead of stranding a provider when the output observer throws', async () => project(async root => {
    const handle = startProviderProcess('codex', invocation(root, "process.stdout.write('hello'); setInterval(()=>{},1000)"), {
      onOutput: () => { throw new Error('observer unavailable') }, terminationGraceMs: 10,
    })
    const result = await handle.completion
    assert.equal(result.kind, 'spawn-failed')
    assert.ok(result.kind === 'spawn-failed' && result.error.includes('observer unavailable'))
    assert.equal(result.failure?.modelExecution, 'started')
    assert.equal(existsSync(handle.recordPath), false)
  }))
})
