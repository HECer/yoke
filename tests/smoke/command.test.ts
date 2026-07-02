import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runFlowSmoke, type SmokeBrowser, type SmokePage } from '../../src/smoke/command.js'
import { saveConfig, defaultConfig, type SmokeConfig } from '../../src/retrofit/config.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-smoke-')) })
afterEach(() => {
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
})
