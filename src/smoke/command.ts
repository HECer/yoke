import { lstatSync, mkdirSync, rmSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { loadConfig, type SmokeFlow, type SmokeStep } from '../retrofit/config.js'
import { workspaceFingerprint } from '../workspace/fingerprint.js'
import { statePath } from '../workspace/state.js'

// Structural browser interface: the real path adapts Playwright's chromium,
// tests inject a filesystem-level fake. Playwright is a TARGET-project
// dependency, never Yoke's.
export interface SmokePage {
  goto(url: string, opts?: object): Promise<{ ok(): boolean; status(): number } | null>
  waitForSelector(sel: string, opts?: object): Promise<unknown>
  click?(selector: string, opts?: { timeout: number }): Promise<unknown>
  fill?(selector: string, value: string, opts?: { timeout: number }): Promise<unknown>
  press?(selector: string, key: string, opts?: { timeout: number }): Promise<unknown>
  textContent?(selector: string, opts?: { timeout: number }): Promise<string | null>
  waitForURL?(match: (url: URL) => boolean, opts?: object): Promise<unknown>
  reload?(opts?: object): Promise<{ ok(): boolean; status(): number } | null>
  screenshot(opts: { path: string; fullPage?: boolean; timeout?: number }): Promise<unknown>
  on(event: 'console' | 'pageerror', handler: (arg: unknown) => void): void
  video(): { path(): Promise<string> } | null
}
export interface SmokeContext { newPage(): Promise<SmokePage>; close(): Promise<void> }
export interface SmokeBrowser {
  newContext(opts?: object): Promise<SmokeContext>
  close(): Promise<void>
  version?(): string
}

export interface FlowSmokeOptions {
  url?: string
  label?: string
  // null = playwright unresolvable in the target project (exit 2)
  launch?: (targetDir: string) => Promise<SmokeBrowser | null>
}

const CONFIG_GUIDANCE = [
  'No smoke flows configured. Add a smoke section to .yoke/config.yaml, e.g.:',
  '',
  'smoke:',
  '  baseUrl: http://localhost:3000',
  '  flows:',
  '    - name: home',
  '      path: /',
  '      landmark: "main h1"',
].join('\n')

export async function launchPlaywright(targetDir: string): Promise<SmokeBrowser | null> {
  try {
    // createRequire needs an absolute anchor — a relative targetDir (the CLI
    // default '.') would throw and masquerade as "playwright not found".
    // Playwright is CJS, so load it with native require() rather than a
    // file:// dynamic import — the URL round-trip breaks under Windows 8.3
    // short paths (e.g. RUNNER~1 on CI) and test-runner import interception.
    const req = createRequire(join(resolve(targetDir), 'package.json'))
    const pw = req('playwright') as { chromium?: { launch(o: object): Promise<SmokeBrowser> }; default?: { chromium: { launch(o: object): Promise<SmokeBrowser> } } }
    const chromium = pw.chromium ?? pw.default?.chromium
    if (!chromium) return null
    return await chromium.launch({ headless: true, timeout: 30_000 })
  } catch {
    return null
  }
}

// Flow names come from user config and become filenames — keep them safe.
function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, '-').slice(0, 120) || 'flow'
}

// The label names a directory that gets rmSync'd recursively — it must never
// carry path semantics ('..', separators). Dots are stripped entirely so a
// bare '..' cannot survive; an emptied label falls back to 'latest'.
export function safeLabel(label: string): string {
  const cleaned = label.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'latest'
}

type SmokeFailureCode = 'timeout' | 'step-failed' | 'unsupported-action' | 'fill-value-unavailable' | 'navigation-failed' | 'http-error' | 'landmark-missing' | 'console-errors' | 'context-failed' | 'context-cleanup-failed' | 'screenshot-failed'
type SmokeStageReport = { status: 'passed' | 'failed' | 'skipped'; durationMs: number; failure?: SmokeFailureCode }
export interface SmokeStepReport extends SmokeStageReport { index: number; action: SmokeStep['action'] }
export interface SmokeFlowReport {
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  navigation: SmokeStageReport
  landmark?: SmokeStageReport
  steps: SmokeStepReport[]
  failure?: SmokeFailureCode
  screenshot?: string
  failureVideo?: string
}
export interface FlowSmokeReport {
  version: 1
  startedAt: string
  generatedAt: string
  durationMs: number
  status: 'passed' | 'failed'
  sourceFingerprint: string
  afterSourceFingerprint: string | null
  sourceStable: boolean
  configDigest: string
  environment: { platform: string; architecture: string; nodeVersion: string; driver: 'injected' | 'playwright-chromium'; browserVersion?: string; baseOrigin: string; viewport: { width: number; height: number } }
  flows: SmokeFlowReport[]
  failure?: 'source-changed-or-unavailable' | 'browser-cleanup-failed'
}
class SmokeFailure extends Error {
  constructor(readonly code: SmokeFailureCode) { super(code) }
}

function failureCode(error: unknown, fallback: SmokeFailureCode): SmokeFailureCode {
  if (error instanceof SmokeFailure) return error.code
  return (error as { name?: string })?.name === 'TimeoutError' ? 'timeout' : fallback
}

async function bounded<T>(operation: () => Promise<T>, timeout: number): Promise<T> {
  if (timeout <= 0) throw new SmokeFailure('timeout')
  const deadline = Date.now() + timeout
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SmokeFailure('timeout')), timeout) }),
    ])
    if (Date.now() >= deadline) throw new SmokeFailure('timeout')
    return result
  } finally { if (timer) clearTimeout(timer) }
}

async function measured(stage: SmokeStageReport, operation: () => Promise<void>, fallback: SmokeFailureCode): Promise<void> {
  const started = Date.now()
  try { await operation(); stage.status = 'passed' }
  catch (error) {
    stage.status = 'failed'
    stage.failure = failureCode(error, fallback)
    throw new SmokeFailure(stage.failure)
  } finally { stage.durationMs = Date.now() - started }
}

async function executeStep(page: SmokePage, step: SmokeStep, baseUrl: string, timeout: number, fillValue: string | undefined): Promise<void> {
  switch (step.action) {
    case 'click':
      if (!page.click) throw new SmokeFailure('unsupported-action')
      await page.click(step.selector, { timeout }); return
    case 'fill':
      if (fillValue === undefined || fillValue.length > 8192) throw new SmokeFailure('fill-value-unavailable')
      if (!page.fill) throw new SmokeFailure('unsupported-action')
      await page.fill(step.selector, fillValue, { timeout }); return
    case 'press':
      if (!page.press) throw new SmokeFailure('unsupported-action')
      await page.press(step.selector, step.key, { timeout }); return
    case 'expect-visible':
      await page.waitForSelector(step.selector, { state: 'visible', timeout }); return
    case 'expect-text': {
      if (!page.textContent) throw new SmokeFailure('unsupported-action')
      const deadline = Date.now() + timeout
      await page.waitForSelector(step.selector, { state: 'visible', timeout })
      const normalize = (value: string) => value.replace(/\s+/gu, ' ').trim()
      const expected = normalize(step.text)
      // Both a fixed attempt bound and the enclosing deadline apply. No unbounded
      // polling, even when a test adapter ignores Playwright's own timeout option.
      for (let attempt = 0; attempt <= Math.ceil(timeout / 100); attempt++) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) break
        const actual = normalize(await page.textContent(step.selector, { timeout: remaining }) ?? '')
        if (Date.now() < deadline && (step.exact ? actual === expected : actual.includes(expected))) return
        await new Promise<void>(resolveValue => setTimeout(resolveValue, Math.max(0, Math.min(100, deadline - Date.now()))))
      }
      throw new SmokeFailure('timeout')
    }
    case 'expect-url': {
      if (!page.waitForURL) throw new SmokeFailure('unsupported-action')
      const expected = new URL(step.url, baseUrl).href
      await page.waitForURL(url => url.href === expected, { waitUntil: 'load', timeout }); return
    }
    case 'reload': {
      if (!page.reload) throw new SmokeFailure('unsupported-action')
      const response = await page.reload({ waitUntil: 'load', timeout })
      if (response && !response.ok()) throw new SmokeFailure('http-error')
      return
    }
    default: {
      const unexpected: never = step
      void unexpected
      throw new SmokeFailure('unsupported-action')
    }
  }
}

async function runFlow(browser: SmokeBrowser, flow: SmokeFlow, baseUrl: string, proofDir: string, fileStem: string, fillValues: Map<SmokeStep, string | undefined>, name: string): Promise<SmokeFlowReport> {
  const started = Date.now(), deadline = started + (flow.timeoutMs ?? 60_000)
  const report: SmokeFlowReport = {
    name, status: 'failed', durationMs: 0, navigation: { status: 'skipped', durationMs: 0 },
    ...(flow.landmark ? { landmark: { status: 'skipped' as const, durationMs: 0 } } : {}),
    steps: (flow.steps ?? []).map((step, index) => ({ index: index + 1, action: step.action, status: 'skipped', durationMs: 0 })),
  }
  let context: SmokeContext | undefined, page: SmokePage | undefined, consoleErrors = 0
  let video: ReturnType<SmokePage['video']> = null
  const remaining = (limit: number) => Math.min(limit, deadline - Date.now())
  const assertNoConsoleErrors = () => { if (consoleErrors > 0) throw new SmokeFailure('console-errors') }
  try {
    context = await bounded(() => browser.newContext({ recordVideo: { dir: join(proofDir, '.video-tmp') }, viewport: { width: 1280, height: 720 } }), remaining(30_000))
    page = await bounded(() => context!.newPage(), remaining(30_000))
    const activePage = page
    // Browser diagnostics can echo input values. Count them; never persist their
    // text, call logs, selectors or parameters in the machine-readable report.
    page.on('console', msg => { if ((msg as { type?: () => string })?.type?.() === 'error') consoleErrors++ })
    page.on('pageerror', () => { consoleErrors++ })
    await measured(report.navigation, async () => {
      const timeout = remaining(30_000)
      const response = await bounded(() => activePage.goto(baseUrl + flow.path, { waitUntil: 'load', timeout }), timeout)
      if (response && !response.ok()) throw new SmokeFailure('http-error')
      assertNoConsoleErrors()
    }, 'navigation-failed')
    if (flow.landmark && report.landmark) {
      await measured(report.landmark, async () => {
        const timeout = remaining(10_000)
        await bounded(() => activePage.waitForSelector(flow.landmark!, { state: 'visible', timeout }), timeout)
        assertNoConsoleErrors()
      }, 'landmark-missing')
    }
    for (const [index, step] of (flow.steps ?? []).entries()) {
      await measured(report.steps[index], async () => {
        const timeout = remaining(step.timeoutMs ?? 10_000)
        await bounded(() => executeStep(activePage, step, baseUrl, timeout, fillValues.get(step)), timeout)
        assertNoConsoleErrors()
      }, 'step-failed')
    }
  } catch (error) { report.failure = failureCode(error, 'context-failed') }
  finally {
    if (page) {
      try {
        await bounded(() => page!.screenshot({ path: join(proofDir, `${fileStem}.png`), fullPage: true, timeout: 5000 }), 5000)
        const saved = lstatSync(join(proofDir, `${fileStem}.png`))
        if (!saved.isFile() || saved.size === 0) throw new SmokeFailure('screenshot-failed')
        report.screenshot = `${fileStem}.png`
      } catch { report.failure ??= 'screenshot-failed' }
      try { video = page.video() } catch { /* Video is best-effort evidence. */ }
    }
    if (context) {
      try { await bounded(() => context!.close(), 5000) }
      catch { report.failure ??= 'context-cleanup-failed' }
    }
    if (video) {
      try {
        const path = await bounded(() => video!.path(), 5000)
        if (report.failure) {
          renameSync(path, join(proofDir, `${fileStem}.webm`))
          report.failureVideo = `${fileStem}.webm`
        } else rmSync(path, { force: true })
      } catch { /* Preserve the original failure if video is unavailable. */ }
    }
  }
  report.status = report.failure ? 'failed' : 'passed'
  report.durationMs = Date.now() - started
  return report
}

export async function runFlowSmoke(targetDir: string, opts: FlowSmokeOptions = {}): Promise<number> {
  const config = loadConfig(targetDir)
  const smoke = config?.smoke
  if (!smoke) {
    console.error(CONFIG_GUIDANCE)
    return 2
  }
  const baseUrl = opts.url ?? smoke.baseUrl
  const label = safeLabel(opts.label ?? process.env.YOKE_STORY ?? 'latest')
  const proofRel = join('.yoke', 'proof', label)
  let proofDir: string, sourceFingerprint: string
  try { proofDir = statePath(targetDir, 'proof', label); sourceFingerprint = workspaceFingerprint(targetDir) }
  catch { console.error('Smoke evidence path or source fingerprint could not be verified; previous evidence was preserved.'); return 2 }
  const started = Date.now()
  const fillValues = new Map<SmokeStep, string | undefined>()
  for (const flow of smoke.flows) for (const step of flow.steps ?? []) {
    if (step.action === 'fill') fillValues.set(step, step.value ?? (step.valueEnv ? process.env[step.valueEnv] : undefined))
  }
  const configDigest = createHash('sha256').update(JSON.stringify({ smoke, baseUrl, resolvedFillValues: [...fillValues.values()] })).digest('hex')
  const redact = (text: string) => [...fillValues.values()].filter((value): value is string => !!value).sort((a, b) => b.length - a.length).reduce((current, value) => current.split(value).join('[redacted]'), text)

  const launch = opts.launch ?? launchPlaywright
  let browser: SmokeBrowser | null
  try { browser = await bounded(() => launch(targetDir), 30_000) }
  catch { console.error('Smoke browser could not start; previous evidence was preserved.'); return 2 }
  if (!browser) {
    console.error(`Playwright not found in ${targetDir}. Install it: npm i -D playwright && npx playwright install chromium`)
    return 2
  }
  // Wipe only once the run is actually going to happen — an exit-2 run must
  // not destroy the previous run's evidence.
  try {
    statePath(targetDir, 'proof', label)
    rmSync(proofDir, { recursive: true, force: true }) // fresh evidence per run
    mkdirSync(proofDir, { recursive: true })
  } catch {
    try { await bounded(() => browser.close(), 5000) } catch { /* Report setup failed. */ }
    console.error('Smoke evidence directory could not be prepared.'); return 2
  }
  const videoTmp = join(proofDir, '.video-tmp')
  let baseOrigin = 'unavailable', browserVersion: string | undefined
  try { baseOrigin = new URL(baseUrl).origin } catch { /* Navigation reports the invalid address. */ }
  try { const version = browser.version?.(); if (version) browserVersion = redact(version.slice(0, 120)) } catch { /* Optional runtime metadata. */ }
  const report: FlowSmokeReport = {
    version: 1, startedAt: new Date(started).toISOString(), generatedAt: '', durationMs: 0, status: 'failed',
    sourceFingerprint, afterSourceFingerprint: null, sourceStable: false, configDigest,
    environment: { platform: process.platform, architecture: process.arch, nodeVersion: process.version, driver: opts.launch ? 'injected' : 'playwright-chromium', ...(browserVersion ? { browserVersion } : {}), baseOrigin: redact(baseOrigin), viewport: { width: 1280, height: 720 } },
    flows: [],
  }
  const filenames = new Set<string>()
  try {
    for (const [index, flow] of smoke.flows.entries()) {
      const baseName = safeName(redact(flow.name))
      let fileStem = baseName, suffix = index + 1
      while (filenames.has(fileStem.toLowerCase())) fileStem = `${baseName}-${suffix++}`
      filenames.add(fileStem.toLowerCase())
      const result = await runFlow(browser, flow, baseUrl, proofDir, fileStem, fillValues, redact(flow.name))
      report.flows.push(result)
      if (result.status === 'failed') {
        const saved = [result.screenshot ? 'screenshot' : null, result.failureVideo ? 'video' : null].filter(Boolean).join(' + ')
        const failedStep = result.steps.find(step => step.status === 'failed')
        console.log(`✘ ${result.name} — ${failedStep ? `step ${failedStep.index} (${failedStep.action}): ` : ''}${result.failure}${saved ? ` (${saved} saved under ${proofRel})` : ''}`)
      } else console.log(`✔ ${result.name} (screenshot: ${join(proofRel, result.screenshot!)})`)
    }
  } finally {
    try { await bounded(() => browser.close(), 5000) }
    catch { report.failure = 'browser-cleanup-failed' }
    rmSync(videoTmp, { recursive: true, force: true })
  }
  try { report.afterSourceFingerprint = workspaceFingerprint(targetDir) } catch { /* Missing identity prevents a pass. */ }
  report.sourceStable = report.sourceFingerprint === report.afterSourceFingerprint
  if (!report.sourceStable) report.failure ??= 'source-changed-or-unavailable'
  const green = report.flows.filter(flow => flow.status === 'passed').length
  report.status = !report.failure && green === smoke.flows.length ? 'passed' : 'failed'
  report.generatedAt = new Date().toISOString()
  report.durationMs = Date.now() - started
  try { writeFileSync(statePath(targetDir, 'proof', label, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 }) }
  catch { console.error('Smoke report could not be saved.'); return 2 }
  if (report.failure) console.log(`✘ Flow-smoke evidence: ${report.failure}`)
  console.log(`Flow-smoke: ${green}/${smoke.flows.length} flows green — proof: ${proofRel}`)
  return report.status === 'passed' ? 0 : 1
}
