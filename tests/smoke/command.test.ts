import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { runFlowSmoke, launchPlaywright, safeLabel, type SmokeBrowser, type SmokePage } from '../../src/smoke/command.js'
import { saveConfig, defaultConfig, type SmokeConfig } from '../../src/retrofit/config.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-smoke-')) })
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
  delete process.env.YOKE_STORY
})

function withSmoke(smoke: SmokeConfig) {
  saveConfig(dir, { ...defaultConfig('1.0.0'), smoke })
}

interface FakeBehavior {
  status?: number            // default 200
  landmarkFound?: boolean    // default true
  consoleErrors?: string[]   // default []
  gotoThrows?: string
}

let vid = 0
function fakeLaunch(behavior: FakeBehavior): (targetDir: string) => Promise<SmokeBrowser | null> {
  return async () => ({
    async newContext(opts?: { recordVideo?: { dir: string } }) {
      const videoDir = opts?.recordVideo?.dir
      let videoPath: string | null = null
      if (videoDir) {
        mkdirSync(videoDir, { recursive: true })
        videoPath = join(videoDir, `v${vid++}.webm`)
        writeFileSync(videoPath, 'vid')
      }
      const handlers: Record<string, ((a: unknown) => void)[]> = { console: [], pageerror: [] }
      const page: SmokePage = {
        async goto() {
          if (behavior.gotoThrows) throw new Error(behavior.gotoThrows)
          for (const e of behavior.consoleErrors ?? []) {
            for (const h of handlers.console) h({ type: () => 'error', text: () => e })
          }
          const status = behavior.status ?? 200
          return { ok: () => status >= 200 && status < 300, status: () => status }
        },
        async waitForSelector() {
          if (behavior.landmarkFound === false) throw new Error('timeout')
          return {}
        },
        async screenshot({ path }: { path: string }) {
          mkdirSync(dirname(path), { recursive: true })
          writeFileSync(path, 'png')
        },
        on(event: 'console' | 'pageerror', handler: (a: unknown) => void) { handlers[event].push(handler) },
        video: () => (videoPath ? { path: async () => videoPath as string } : null),
      }
      return { newPage: async () => page, close: async () => {} }
    },
    async close() {},
  })
}

const HOME = { name: 'home', path: '/', landmark: 'main h1' }

describe('runFlowSmoke', () => {
  it('requires served-source identity before a production browser launch', async () => {
    withSmoke({ baseUrl: 'http://x', flows: [HOME] })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await runFlowSmoke(dir)).toBe(2)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('sourceIdentity is required'))
  })
  it('rejects a foreign server before browser launch and preserves old proofs', async () => {
    const server = createServer((_req, res) => res.end('other-worktree'))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    const launch = vi.fn(fakeLaunch({}))
    try {
      withSmoke({ baseUrl: `http://127.0.0.1:${address.port}`, flows: [HOME],
        sourceIdentity: { path: '/source-id', sha256: createHash('sha256').update('expected-source').digest('hex') } })
      const proof = join(dir, '.yoke', 'proof', 'latest')
      mkdirSync(proof, { recursive: true })
      writeFileSync(join(proof, 'home.png'), 'previous evidence')
      expect(await runFlowSmoke(dir, { launch })).toBe(2)
      expect(launch).not.toHaveBeenCalled()
      expect(readFileSync(join(proof, 'home.png'), 'utf8')).toBe('previous evidence')
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })
  it('records verified served-source identity and rechecks it after the flows', async () => {
    let requests = 0
    const server = createServer((_req, res) => { requests++; res.end('expected-source') })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    try {
      withSmoke({ baseUrl: `http://127.0.0.1:${address.port}`, flows: [HOME],
        sourceIdentity: { path: '/source-id', sha256: createHash('sha256').update('expected-source').digest('hex') } })
      expect(await runFlowSmoke(dir, { launch: fakeLaunch({}) })).toBe(0)
      const report = JSON.parse(readFileSync(join(dir, '.yoke', 'proof', 'latest', 'report.json'), 'utf8'))
      expect(report.serverIdentity).toBe('verified')
      expect(requests).toBe(2)
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })
  it('exits 2 with guidance when there is no smoke config', async () => {
    saveConfig(dir, defaultConfig('1.0.0'))
    expect(await runFlowSmoke(dir, { launch: fakeLaunch({}) })).toBe(2)
  })

  it('exits 2 when playwright cannot be resolved (launch returns null)', async () => {
    withSmoke({ baseUrl: 'http://x', flows: [HOME] })
    expect(await runFlowSmoke(dir, { launch: async () => null })).toBe(2)
  })

  it('green flow: exit 0, screenshot saved, video deleted', async () => {
    withSmoke({ baseUrl: 'http://x', flows: [HOME] })
    const code = await runFlowSmoke(dir, { launch: fakeLaunch({}) })
    expect(code).toBe(0)
    const proof = join(dir, '.yoke', 'proof', 'latest')
    expect(existsSync(join(proof, 'home.png'))).toBe(true)
    expect(readdirSync(proof).some(f => f.endsWith('.webm'))).toBe(false)
    expect(existsSync(join(proof, '.video-tmp'))).toBe(false)
  })

  it('landmark timeout: exit 1, screenshot still saved, video kept', async () => {
    withSmoke({ baseUrl: 'http://x', flows: [HOME] })
    const code = await runFlowSmoke(dir, { launch: fakeLaunch({ landmarkFound: false }) })
    expect(code).toBe(1)
    const proof = join(dir, '.yoke', 'proof', 'latest')
    expect(existsSync(join(proof, 'home.png'))).toBe(true)
    expect(existsSync(join(proof, 'home.webm'))).toBe(true)
  })

  it('console errors fail the flow', async () => {
    withSmoke({ baseUrl: 'http://x', flows: [HOME] })
    expect(await runFlowSmoke(dir, { launch: fakeLaunch({ consoleErrors: ['boom'] }) })).toBe(1)
  })

  it('a non-OK response fails the flow', async () => {
    withSmoke({ baseUrl: 'http://x', flows: [HOME] })
    expect(await runFlowSmoke(dir, { launch: fakeLaunch({ status: 500 }) })).toBe(1)
  })

  it('a goto crash fails the flow but still screenshots', async () => {
    withSmoke({ baseUrl: 'http://x', flows: [HOME] })
    const code = await runFlowSmoke(dir, { launch: fakeLaunch({ gotoThrows: 'net::ERR_CONNECTION_REFUSED' }) })
    expect(code).toBe(1)
    expect(existsSync(join(dir, '.yoke', 'proof', 'latest', 'home.png'))).toBe(true)
  })

  it('label resolution: --label beats YOKE_STORY beats latest', async () => {
    withSmoke({ baseUrl: 'http://x', flows: [{ name: 'home', path: '/' }] })
    process.env.YOKE_STORY = 'S7'
    await runFlowSmoke(dir, { launch: fakeLaunch({}) })
    expect(existsSync(join(dir, '.yoke', 'proof', 'S7', 'home.png'))).toBe(true)
    await runFlowSmoke(dir, { launch: fakeLaunch({}), label: 'manual' })
    expect(existsSync(join(dir, '.yoke', 'proof', 'manual', 'home.png'))).toBe(true)
  })

  it('wipes the label dir before a run', async () => {
    withSmoke({ baseUrl: 'http://x', flows: [{ name: 'home', path: '/' }] })
    const proof = join(dir, '.yoke', 'proof', 'latest')
    mkdirSync(proof, { recursive: true })
    writeFileSync(join(proof, 'stale.png'), 'old')
    await runFlowSmoke(dir, { launch: fakeLaunch({}) })
    expect(existsSync(join(proof, 'stale.png'))).toBe(false)
    expect(existsSync(join(proof, 'home.png'))).toBe(true)
  })

  it('a failing flow does not stop later flows', async () => {
    withSmoke({ baseUrl: 'http://x', flows: [HOME, { name: 'about', path: '/about' }] })
    // landmarkFound:false only affects flows WITH a landmark — about has none and passes
    const code = await runFlowSmoke(dir, { launch: fakeLaunch({ landmarkFound: false }) })
    expect(code).toBe(1)
    const proof = join(dir, '.yoke', 'proof', 'latest')
    expect(existsSync(join(proof, 'home.png'))).toBe(true)
    expect(existsSync(join(proof, 'about.png'))).toBe(true)
  })

  it('--url overrides baseUrl (fake records the target url)', async () => {
    withSmoke({ baseUrl: 'http://x', flows: [{ name: 'home', path: '/p' }] })
    const seen: string[] = []
    const launch = fakeLaunch({})
    const spying: typeof launch = async (t) => {
      const b = await launch(t)
      if (!b) return null
      const orig = b.newContext.bind(b)
      b.newContext = async (o?: object) => {
        const ctx = await orig(o)
        const origPage = ctx.newPage.bind(ctx)
        ctx.newPage = async () => {
          const p = await origPage()
          const g = p.goto.bind(p)
          p.goto = async (url: string, o2?: object) => { seen.push(url); return g(url, o2) }
          return p
        }
        return ctx
      }
      return b
    }
    await runFlowSmoke(dir, { launch: spying, url: 'http://override:9999' })
    expect(seen[0]).toBe('http://override:9999/p')
  })

  it('sanitizes a path-traversal label instead of deleting outside the proof dir', async () => {
    withSmoke({ baseUrl: 'http://x', flows: [{ name: 'home', path: '/' }] })
    const code = await runFlowSmoke(dir, { launch: fakeLaunch({}), label: '..' })
    expect(code).toBe(0)
    // .yoke (and the config) must survive; the label collapses to 'latest'
    expect(existsSync(join(dir, '.yoke', 'config.yaml'))).toBe(true)
    expect(existsSync(join(dir, '.yoke', 'proof', 'latest', 'home.png'))).toBe(true)
  })

  it('sanitizes a YOKE_STORY with path separators', async () => {
    withSmoke({ baseUrl: 'http://x', flows: [{ name: 'home', path: '/' }] })
    process.env.YOKE_STORY = '../evil/S7'
    await runFlowSmoke(dir, { launch: fakeLaunch({}) })
    expect(existsSync(join(dir, '.yoke', 'config.yaml'))).toBe(true)
    expect(existsSync(join(dir, '.yoke', 'proof', 'evil-S7', 'home.png'))).toBe(true)
  })

  it('an exit-2 run does not destroy previous evidence', async () => {
    withSmoke({ baseUrl: 'http://x', flows: [{ name: 'home', path: '/' }] })
    const proof = join(dir, '.yoke', 'proof', 'latest')
    mkdirSync(proof, { recursive: true })
    writeFileSync(join(proof, 'home.png'), 'previous evidence')
    const code = await runFlowSmoke(dir, { launch: async () => null })
    expect(code).toBe(2)
    expect(existsSync(join(proof, 'home.png'))).toBe(true)
  })
})

describe('safeLabel', () => {
  it('strips path semantics and falls back to latest', () => {
    expect(safeLabel('S7')).toBe('S7')
    expect(safeLabel('STORY-12')).toBe('STORY-12')
    expect(safeLabel('..')).toBe('latest')
    expect(safeLabel('../..')).toBe('latest')
    expect(safeLabel('a/b\\c')).toBe('a-b-c')
  })
})

describe('launchPlaywright', () => {
  it.each([
    ['Executable does not exist at /browser/chromium', 'browser-binary-missing'],
    ['spawn EPERM', 'browser-permission-denied'],
    ['unexpected driver failure', 'browser-launch-failed'],
  ])('keeps installed-package launch failure %s distinct from missing Playwright', async (message, code) => {
    const pkgDir = join(dir, 'node_modules', 'playwright')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'playwright', main: 'index.js' }))
    writeFileSync(join(pkgDir, 'index.js'), `module.exports = { chromium: { launch: async () => { throw new Error(${JSON.stringify(message)}) } } };`)
    await expect(launchPlaywright(dir)).rejects.toMatchObject({ code, message: expect.stringContaining(message) })
  })
  it('reports a redacted launch cause while preserving old evidence', async () => {
    withSmoke({ baseUrl: 'http://x', flows: [{ ...HOME, steps: [{ action: 'fill', selector: 'input', value: 'testing-password' }] }] })
    const proof = join(dir, '.yoke', 'proof', 'latest')
    mkdirSync(proof, { recursive: true })
    writeFileSync(join(proof, 'home.png'), 'previous evidence')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await runFlowSmoke(dir, { launch: async () => { throw new Error('driver refused testing-password') } })).toBe(2)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('driver refused [redacted]'))
    expect(error.mock.calls.flat().join(' ')).not.toContain('testing-password')
    expect(readFileSync(join(proof, 'home.png'), 'utf8')).toBe('previous evidence')
  })
  it('redacts OAuth and Authorization credentials in launch diagnostics', async () => {
    withSmoke({ baseUrl: 'http://x', flows: [HOME] })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await runFlowSmoke(dir, { launch: async () => { throw new Error('access_token=private-access refresh_token=private-refresh Authorization: Bearer private-bearer') } })).toBe(2)
    const text = error.mock.calls.flat().join(' ')
    expect(text).not.toContain('private-access')
    expect(text).not.toContain('private-refresh')
    expect(text).not.toContain('private-bearer')
    expect(text).toContain('[redacted]')
  })
  it('resolves playwright from a RELATIVE targetDir (the CLI default ".")', async () => {
    // stub playwright package: chromium.launch returns a minimal browser object
    const pkgDir = join(dir, 'node_modules', 'playwright')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'playwright', version: '0.0.0', main: 'index.js' }))
    writeFileSync(join(pkgDir, 'index.js'),
      'module.exports = { chromium: { launch: async () => ({ newContext: async () => { throw new Error("stub") }, close: async () => {} }) } };\n')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'target', version: '0.0.0' }))
    const prev = process.cwd()
    process.chdir(dir)
    try {
      const browser = await launchPlaywright('.')
      expect(browser).not.toBeNull()
      await browser?.close()
    } finally {
      process.chdir(prev)
    }
  })

  it('reports an invalid package when the resolved module has no chromium export', async () => {
    const pkgDir = join(dir, 'node_modules', 'playwright')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'playwright', version: '0.0.0', main: 'index.js' }))
    writeFileSync(join(pkgDir, 'index.js'), 'module.exports = {};\n')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'target', version: '0.0.0' }))
    await expect(launchPlaywright(dir)).rejects.toMatchObject({ code: 'browser-export-missing' })
  })
})
