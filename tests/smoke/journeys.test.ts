import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runFlowSmoke, type SmokeBrowser, type SmokePage } from '../../src/smoke/command.js'
import { defaultConfig, saveConfig, type SmokeConfig } from '../../src/retrofit/config.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-journeys-')); writeFileSync(join(dir, 'source.txt'), 'application source') })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }) })

type Call = { action: string; args: unknown[] }
function fakeBrowser(options: { hook?: (call: Call) => void | Promise<void>; text?: () => string; url?: string } = {}) {
  const calls: Call[] = []
  let count = 0
  const invoke = async (action: string, ...args: unknown[]) => {
    const call = { action, args }
    calls.push(call)
    await options.hook?.(call)
  }
  const response = { ok: () => true, status: () => 200 }
  const browser: SmokeBrowser = {
    async newContext(settings?: object) {
      await invoke('context')
      const path = join((settings as { recordVideo: { dir: string } }).recordVideo.dir, `video-${++count}.webm`)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, 'video')
      const page: SmokePage = {
        async goto(url, settings) { await invoke('navigate', url, settings); return response },
        async waitForSelector(selector, settings) { await invoke('visible', selector, settings); return {} },
        async click(selector, settings) { await invoke('click', selector, settings) },
        async fill(selector, value, settings) { await invoke('fill', selector, value, settings) },
        async press(selector, key, settings) { await invoke('press', selector, key, settings) },
        async textContent(selector, settings) { await invoke('text', selector, settings); return options.text?.() ?? 'Saved' },
        async waitForURL(match, settings) {
          await invoke('url', settings)
          if (!match(new URL(options.url ?? 'http://app.test:3000/dashboard'))) throw new Error('URL did not match')
        },
        async reload(settings) { await invoke('reload', settings); return response },
        async screenshot({ path }) { await invoke('screenshot'); writeFileSync(path, 'image') },
        on() {},
        video: () => ({ path: async () => path }),
      }
      return { newPage: async () => page, close: async () => { await invoke('context-close') } }
    },
    async close() { await invoke('browser-close') },
    version: () => 'test-browser',
  }
  return { calls, launch: async () => browser }
}
const configure = (smoke: SmokeConfig) => saveConfig(dir, { ...defaultConfig('test'), smoke })
const proof = () => join(dir, '.yoke', 'proof', 'latest')
const report = () => JSON.parse(readFileSync(join(proof(), 'report.json'), 'utf8'))

describe('bounded multi-step smoke journeys', () => {
  it('runs actions in order and binds a value-free report to the source, effective configuration and runtime', async () => {
    const secret = 'private-test-password-9291'
    vi.stubEnv('YOKE_SMOKE_TEST_PASSWORD', secret)
    configure({ baseUrl: 'http://app.test:3000', flows: [{ name: 'save-profile', path: '/profile', steps: [
      { action: 'fill', selector: '#name', value: 'Ada-private-input' },
      { action: 'fill', selector: '#password', valueEnv: 'YOKE_SMOKE_TEST_PASSWORD' },
      { action: 'click', selector: '#save' },
      { action: 'press', selector: '#search', key: 'Enter' },
      { action: 'expect-visible', selector: '[data-testid=saved]' },
      { action: 'expect-text', selector: '[data-testid=saved]', text: 'Saved', exact: true },
      { action: 'expect-url', url: '/dashboard' },
      { action: 'reload' },
    ] }] })
    const fake = fakeBrowser()
    expect(await runFlowSmoke(dir, { launch: fake.launch })).toBe(0)
    expect(fake.calls.filter(call => ['fill', 'click', 'press', 'url', 'reload'].includes(call.action)).map(call => call.action)).toEqual(['fill', 'fill', 'click', 'press', 'url', 'reload'])
    expect(fake.calls.find(call => call.action === 'fill' && call.args[0] === '#password')?.args[1]).toBe(secret)
    const saved = report()
    expect(saved).toMatchObject({ version: 1, status: 'passed', sourceStable: true, environment: { platform: process.platform, architecture: process.arch, nodeVersion: process.version, driver: 'injected', browserVersion: 'test-browser', baseOrigin: 'http://app.test:3000' } })
    expect(saved.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/u)
    expect(saved.afterSourceFingerprint).toBe(saved.sourceFingerprint)
    expect(saved.configDigest).toMatch(/^[a-f0-9]{64}$/u)
    expect(saved.flows[0].steps).toHaveLength(8)
    expect(saved.flows[0].steps.every((step: { status: string }, index: number) => step.status === 'passed' && saved.flows[0].steps[index].index === index + 1)).toBe(true)
    const raw = JSON.stringify(saved)
    for (const value of [secret, 'Ada-private-input', '#password', 'YOKE_SMOKE_TEST_PASSWORD', '[data-testid=saved]']) expect(raw).not.toContain(value)
    expect(existsSync(join(proof(), 'save-profile.png'))).toBe(true)
    expect(existsSync(join(proof(), 'save-profile.webm'))).toBe(false)
  })

  it('fails a step, skips the remaining steps, captures failure evidence, and still runs later flows without leaking driver errors', async () => {
    const secret = 'driver-must-not-report-this-value'
    configure({ baseUrl: 'http://app.test:3000', flows: [
      { name: 'login', path: '/login', steps: [{ action: 'fill', selector: '#password', value: secret }, { action: 'click', selector: '#submit' }] },
      { name: 'health', path: '/health' },
    ] })
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    const fake = fakeBrowser({ hook: call => { if (call.action === 'fill') throw new Error(`locator.fill(${secret}) failed at #password`) } })
    expect(await runFlowSmoke(dir, { launch: fake.launch })).toBe(1)
    const saved = report()
    expect(saved.status).toBe('failed')
    expect(saved.flows.map((flow: { status: string }) => flow.status)).toEqual(['failed', 'passed'])
    expect(saved.flows[0].steps.map((step: { status: string }) => step.status)).toEqual(['failed', 'skipped'])
    expect(fake.calls.some(call => call.action === 'click')).toBe(false)
    expect(JSON.stringify(saved)).not.toContain(secret)
    expect(JSON.stringify(output.mock.calls)).not.toContain(secret)
    expect(existsSync(join(proof(), 'login.png'))).toBe(true)
    expect(existsSync(join(proof(), 'login.webm'))).toBe(true)
    expect(existsSync(join(proof(), 'health.png'))).toBe(true)
    expect(existsSync(join(proof(), '.video-tmp'))).toBe(false)
    expect(fake.calls.at(-1)?.action).toBe('browser-close')
  })

  it('fails a missing environment-backed fill without calling fill or recording the variable name', async () => {
    vi.stubEnv('YOKE_SMOKE_MISSING_VALUE', undefined)
    configure({ baseUrl: 'http://app.test:3000', flows: [{ name: 'login', path: '/', steps: [{ action: 'fill', selector: '#password', valueEnv: 'YOKE_SMOKE_MISSING_VALUE' }] }] })
    const fake = fakeBrowser()
    expect(await runFlowSmoke(dir, { launch: fake.launch })).toBe(1)
    expect(fake.calls.some(call => call.action === 'fill')).toBe(false)
    expect(report().flows[0].steps[0].status).toBe('failed')
    expect(JSON.stringify(report())).not.toContain('YOKE_SMOKE_MISSING_VALUE')
  })

  it('times out a hung action and closes its context', async () => {
    configure({ baseUrl: 'http://app.test:3000', flows: [{ name: 'hung', path: '/', steps: [{ action: 'click', selector: '#never', timeoutMs: 5 }] }] })
    const fake = fakeBrowser({ hook: call => call.action === 'click' ? new Promise<void>(() => {}) : undefined })
    expect(await runFlowSmoke(dir, { launch: fake.launch })).toBe(1)
    expect(report().flows[0].steps[0]).toMatchObject({ status: 'failed', failure: 'timeout' })
    expect(fake.calls.some(call => call.action === 'context-close')).toBe(true)
  })

  it('counts navigation against the total flow deadline and clamps step timeouts to the remaining time', async () => {
    configure({ baseUrl: 'http://app.test:3000', flows: [{ name: 'bounded', path: '/', timeoutMs: 20, steps: [{ action: 'click', selector: '#slow', timeoutMs: 30_000 }, { action: 'reload' }] }] })
    vi.useFakeTimers()
    const fake = fakeBrowser({ hook: call => ['navigate', 'click'].includes(call.action) ? new Promise<void>(resolve => setTimeout(resolve, 12)) : undefined })
    const running = runFlowSmoke(dir, { launch: fake.launch })
    await vi.advanceTimersByTimeAsync(30)
    expect(await running).toBe(1)
    const settings = fake.calls.find(call => call.action === 'click')?.args[1] as { timeout: number }
    expect(settings.timeout).toBeGreaterThan(0)
    expect(settings.timeout).toBeLessThanOrEqual(8)
    expect(report().flows[0].steps.map((step: { status: string }) => step.status)).toEqual(['failed', 'skipped'])
  })

  it('waits for text changes within a bounded timeout using normalized exact text', async () => {
    configure({ baseUrl: 'http://app.test:3000', flows: [{ name: 'eventual-text', path: '/', steps: [{ action: 'expect-text', selector: '#status', text: 'Saved successfully', exact: true, timeoutMs: 500 }] }] })
    vi.useFakeTimers()
    let reads = 0
    const fake = fakeBrowser({ text: () => ++reads === 1 ? 'Saving' : '  Saved\n successfully  ' })
    const running = runFlowSmoke(dir, { launch: fake.launch })
    await vi.advanceTimersByTimeAsync(150)
    expect(await running).toBe(0)
    expect(reads).toBe(2)
  })

  it('does not report success for a mismatching URL or text even when navigation succeeded', async () => {
    configure({ baseUrl: 'http://app.test:3000', flows: [
      { name: 'wrong-url', path: '/', steps: [{ action: 'expect-url', url: '/expected' }] },
      { name: 'wrong-text', path: '/', steps: [{ action: 'expect-text', selector: '#status', text: 'Ready', timeoutMs: 5 }] },
    ] })
    const fake = fakeBrowser()
    expect(await runFlowSmoke(dir, { launch: fake.launch })).toBe(1)
    expect(report().flows.every((flow: { status: string }) => flow.status === 'failed')).toBe(true)
  })

  it('fails snapshot binding when application source changes during the journey', async () => {
    configure({ baseUrl: 'http://app.test:3000', flows: [{ name: 'changes', path: '/', steps: [{ action: 'click', selector: '#save' }] }] })
    const fake = fakeBrowser({ hook: call => { if (call.action === 'click') writeFileSync(join(dir, 'source.txt'), 'changed during verification') } })
    expect(await runFlowSmoke(dir, { launch: fake.launch })).toBe(1)
    expect(report()).toMatchObject({ status: 'failed', sourceStable: false })
    expect(report().sourceFingerprint).not.toBe(report().afterSourceFingerprint)
  })

  it('requires a screenshot and retains the failure video when screenshot capture fails', async () => {
    configure({ baseUrl: 'http://app.test:3000', flows: [{ name: 'evidence', path: '/' }] })
    const fake = fakeBrowser({ hook: call => { if (call.action === 'screenshot') throw new Error('page crashed while screenshotting') } })
    expect(await runFlowSmoke(dir, { launch: fake.launch })).toBe(1)
    expect(report().flows[0]).toMatchObject({ status: 'failed', failure: 'screenshot-failed', failureVideo: 'evidence.webm' })
  })

  it('records a context-creation failure and continues with the next flow', async () => {
    configure({ baseUrl: 'http://app.test:3000', flows: [{ name: 'cannot-start', path: '/' }, { name: 'next', path: '/' }] })
    let contexts = 0
    const fake = fakeBrowser({ hook: call => { if (call.action === 'context' && ++contexts === 1) throw new Error('browser context failed') } })
    expect(await runFlowSmoke(dir, { launch: fake.launch })).toBe(1)
    expect(report().flows.map((flow: { status: string }) => flow.status)).toEqual(['failed', 'passed'])
    expect(report().flows[0]).toMatchObject({ failure: 'context-failed', navigation: { status: 'skipped' } })
    expect(fake.calls.at(-1)?.action).toBe('browser-close')
  })

  it('fails the report when browser cleanup cannot be confirmed', async () => {
    configure({ baseUrl: 'http://app.test:3000', flows: [{ name: 'cleanup', path: '/' }] })
    const fake = fakeBrowser({ hook: call => { if (call.action === 'browser-close') throw new Error('browser failed to close') } })
    expect(await runFlowSmoke(dir, { launch: fake.launch })).toBe(1)
    expect(report()).toMatchObject({ status: 'failed', failure: 'browser-cleanup-failed', sourceStable: true })
    expect(report().flows[0].status).toBe('passed')
  })

  it('hashes changed effective inputs without serializing values, credentials or query strings', async () => {
    vi.stubEnv('YOKE_SMOKE_VALUE', 'first-private-value')
    configure({ baseUrl: 'http://app.test:3000', flows: [{ name: 'input', path: '/', steps: [{ action: 'fill', selector: '#value', valueEnv: 'YOKE_SMOKE_VALUE' }] }] })
    const fake = fakeBrowser()
    const url = 'http://username:password@app.test:3000'
    expect(await runFlowSmoke(dir, { launch: fake.launch, url })).toBe(0)
    const first = report().configDigest
    vi.stubEnv('YOKE_SMOKE_VALUE', 'second-private-value')
    expect(await runFlowSmoke(dir, { launch: fake.launch, url })).toBe(0)
    expect(report().configDigest).not.toBe(first)
    expect(report().environment.baseOrigin).toBe('http://app.test:3000')
    for (const sensitive of ['username', 'password', 'first-private-value', 'second-private-value']) expect(JSON.stringify(report())).not.toContain(sensitive)
  })

  it('keeps evidence for flow names that sanitize to the same filename', async () => {
    configure({ baseUrl: 'http://app.test:3000', flows: [{ name: 'same/name', path: '/' }, { name: 'same name', path: '/' }] })
    expect(await runFlowSmoke(dir, { launch: fakeBrowser().launch })).toBe(0)
    const filenames = report().flows.map((flow: { screenshot: string }) => flow.screenshot)
    expect(new Set(filenames).size).toBe(2)
    expect(filenames.every((filename: string) => existsSync(join(proof(), filename)))).toBe(true)
  })

  it('refuses a linked proof parent before deleting any prior evidence', async () => {
    configure({ baseUrl: 'http://app.test:3000', flows: [{ name: 'safe', path: '/' }] })
    const outside = mkdtempSync(join(tmpdir(), 'yoke-journey-outside-'))
    try {
      mkdirSync(join(outside, 'latest'))
      writeFileSync(join(outside, 'latest', 'keep.txt'), 'outside evidence')
      symlinkSync(outside, join(dir, '.yoke', 'proof'), 'junction')
      expect(await runFlowSmoke(dir, { launch: fakeBrowser().launch })).toBe(2)
      expect(readFileSync(join(outside, 'latest', 'keep.txt'), 'utf8')).toBe('outside evidence')
    } finally { rmSync(outside, { recursive: true, force: true }) }
  })

  it.each([
    { steps: Array.from({ length: 51 }, () => ({ action: 'reload' })) },
    { steps: [{ action: 'click', selector: '#x', timeoutMs: 30_001 }] },
    { timeoutMs: 120_001 },
    { steps: [{ action: 'fill', selector: '#x' }] },
    { steps: [{ action: 'fill', selector: '#x', value: 'x', valueEnv: 'YOKE_X' }] },
    { steps: [{ action: 'evaluate', script: 'unbounded arbitrary code' }] },
    { steps: [{ action: 'reload', unexpected: 'value' }] },
  ])('rejects unsupported or unbounded step configuration before launching: %j', async extension => {
    configure({ baseUrl: 'http://app.test:3000', flows: [{ name: 'invalid', path: '/', ...extension }] } as SmokeConfig)
    const launch = vi.fn(fakeBrowser().launch)
    await expect(runFlowSmoke(dir, { launch })).rejects.toThrow()
    expect(launch).not.toHaveBeenCalled()
  })
})
