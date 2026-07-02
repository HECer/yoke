import { mkdirSync, rmSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { loadConfig } from '../retrofit/config.js'

// Structural browser interface: the real path adapts Playwright's chromium,
// tests inject a filesystem-level fake. Playwright is a TARGET-project
// dependency, never Yoke's.
export interface SmokePage {
  goto(url: string, opts?: object): Promise<{ ok(): boolean; status(): number } | null>
  waitForSelector(sel: string, opts?: object): Promise<unknown>
  screenshot(opts: { path: string; fullPage?: boolean }): Promise<unknown>
  on(event: 'console' | 'pageerror', handler: (arg: unknown) => void): void
  video(): { path(): Promise<string> } | null
}
export interface SmokeContext { newPage(): Promise<SmokePage>; close(): Promise<void> }
export interface SmokeBrowser {
  newContext(opts?: object): Promise<SmokeContext>
  close(): Promise<void>
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
    return await chromium.launch({ headless: true })
  } catch {
    return null
  }
}

// Flow names come from user config and become filenames — keep them safe.
function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, '-')
}

// The label names a directory that gets rmSync'd recursively — it must never
// carry path semantics ('..', separators). Dots are stripped entirely so a
// bare '..' cannot survive; an emptied label falls back to 'latest'.
export function safeLabel(label: string): string {
  const cleaned = label.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'latest'
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
  const proofDir = join(targetDir, proofRel)

  const launch = opts.launch ?? launchPlaywright
  const browser = await launch(targetDir)
  if (!browser) {
    console.error(`Playwright not found in ${targetDir}. Install it: npm i -D playwright && npx playwright install chromium`)
    return 2
  }
  // Wipe only once the run is actually going to happen — an exit-2 run must
  // not destroy the previous run's evidence.
  rmSync(proofDir, { recursive: true, force: true }) // fresh evidence per run
  mkdirSync(proofDir, { recursive: true })
  const videoTmp = join(proofDir, '.video-tmp')

  let green = 0
  try {
    for (const flow of smoke.flows) {
      const context = await browser.newContext({ recordVideo: { dir: videoTmp } })
      const page = await context.newPage()
      const errors: string[] = []
      page.on('console', (msg) => {
        const m = msg as { type?: () => string; text?: () => string }
        if (m.type?.() === 'error') errors.push(String(m.text?.() ?? msg))
      })
      page.on('pageerror', (err) => {
        errors.push(String((err as Error)?.message ?? err))
      })
      let reason: string | undefined
      try {
        const resp = await page.goto(baseUrl + flow.path, { waitUntil: 'load', timeout: 30_000 })
        if (resp && !resp.ok()) reason = `HTTP ${resp.status()}`
        if (!reason && flow.landmark) {
          try {
            await page.waitForSelector(flow.landmark, { timeout: 10_000 })
          } catch {
            reason = `landmark "${flow.landmark}" not found`
          }
        }
        if (!reason && errors.length > 0) {
          reason = `${errors.length} console error(s): ${errors[0].slice(0, 200)}`
        }
      } catch (e) {
        reason = (e as Error).message.split('\n')[0]
      }
      // The screenshot IS the evidence — taken on success AND failure; a crashed
      // page must not mask the original failure.
      const shotName = `${safeName(flow.name)}.png`
      let shotOk = false
      try {
        await page.screenshot({ path: join(proofDir, shotName), fullPage: true })
        shotOk = true
      } catch { /* keep the original reason */ }
      const video = page.video()
      await context.close()
      let videoKept = false
      if (video) {
        try {
          const vpath = await video.path()
          if (reason) {
            renameSync(vpath, join(proofDir, `${safeName(flow.name)}.webm`))
            videoKept = true
          } else {
            rmSync(vpath, { force: true })
          }
        } catch { /* video is best-effort evidence */ }
      }
      if (reason) {
        const saved = [shotOk ? 'screenshot' : null, videoKept ? 'video' : null].filter(Boolean).join(' + ')
        console.log(`✘ ${flow.name} — ${reason}${saved ? ` (${saved} saved under ${proofRel})` : ''}`)
      } else {
        green++
        console.log(`✔ ${flow.name} (screenshot: ${join(proofRel, shotName)})`)
      }
    }
  } finally {
    await browser.close()
    rmSync(videoTmp, { recursive: true, force: true })
  }
  console.log(`Flow-smoke: ${green}/${smoke.flows.length} flows green — proof: ${proofRel}`)
  return green === smoke.flows.length ? 0 : 1
}
