# Baustein M — Flow-Smoke with Proofs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `yoke flow-smoke` — a built-in browser gate that loads configured flows, asserts landmark + zero console errors, always saves screenshots to `.yoke/proof/<label>/`, keeps video only on failure; the loop labels proofs per story via `YOKE_STORY`.

**Architecture:** One async command module (`src/smoke/command.ts`) with a structural `SmokeBrowser` interface; the real path adapts Playwright resolved **from the target project** (never a Yoke dependency); tests inject a filesystem-level fake. Config gains an optional `smoke` section. `main()` in cli.ts becomes awaitable.

**Tech Stack:** Node 20 ESM TypeScript (`.js` import specifiers!), vitest, zod, yaml. No new dependencies (Playwright is a *target-project* dependency).

**Spec:** `docs/superpowers/specs/2026-07-02-baustein-m-flow-smoke-proofs-design.md`

**Pitfalls for the implementer:**
- rtk proxy mangles grep output — verify test results ONLY via `npx vitest run --reporter=json --outputFile=.yoke-test.json` + node parse; delete the file before committing. Conda `pydantic_core` stderr banner = harmless noise.
- `npx tsc --noEmit` before every commit. ESM `.js` import specifiers.
- **Planned deviation from the spec:** the spec's `opts.browser?: () => Promise<SmokeBrowser>` seam is generalized to `opts.launch?: (targetDir: string) => Promise<SmokeBrowser | null>` (null = "playwright unresolvable"). This makes the exit-2 path deterministically testable without depending on ambient playwright resolution on the dev machine. Record this in your final report.

---

### Task 1: `smoke` config section

**Files:**
- Modify: `src/retrofit/config.ts`
- Test: `tests/retrofit/config.test.ts` (extend; if that exact file doesn't exist, extend the existing test file that covers `loadConfig`/`saveConfig` — find it with Glob `tests/retrofit/*config*`)

- [ ] **Step 1: Write the failing tests** (append to the config test file, reusing its temp-dir helpers):

```ts
it('round-trips a smoke section', () => {
  const config = { ...defaultConfig('1.0.0'), smoke: { baseUrl: 'http://localhost:3000', flows: [{ name: 'home', path: '/', landmark: 'main h1' }, { name: 'login', path: '/login' }] } }
  saveConfig(dir, config)
  expect(loadConfig(dir)?.smoke?.flows).toHaveLength(2)
  expect(loadConfig(dir)?.smoke?.flows[0].landmark).toBe('main h1')
})

it('config without smoke stays valid', () => {
  saveConfig(dir, defaultConfig('1.0.0'))
  expect(loadConfig(dir)?.smoke).toBeUndefined()
})

it('rejects a smoke section with empty flows', () => {
  writeFileSync(join(dir, '.yoke', 'config.yaml'), 'canonVersion: "1"\nagents: []\nloop:\n  enabled: false\nsmoke:\n  baseUrl: http://x\n  flows: []\n')
  expect(() => loadConfig(dir)).toThrow()
})
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** in `src/retrofit/config.ts` — above `YokeConfigSchema`:

```ts
const SmokeFlowSchema = z.object({ name: z.string().min(1), path: z.string().min(1), landmark: z.string().optional() })
const SmokeSchema = z.object({ baseUrl: z.string().min(1), flows: z.array(SmokeFlowSchema).min(1) })
```

Add `smoke: SmokeSchema.optional(),` to `YokeConfigSchema` and the interfaces:

```ts
export interface SmokeFlow { name: string; path: string; landmark?: string }
export interface SmokeConfig { baseUrl: string; flows: SmokeFlow[] }
```

plus `smoke?: SmokeConfig` on `YokeConfig`.

- [ ] **Step 4: Run** — config tests PASS, `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit** — `feat(config): optional smoke section (baseUrl + flows)`

---

### Task 2: `runFlowSmoke` core with fake browser

**Files:**
- Create: `src/smoke/command.ts`
- Test: `tests/smoke/command.test.ts`

- [ ] **Step 1: Write the failing tests:**

```ts
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
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement `src/smoke/command.ts`:**

```ts
import { existsSync, mkdirSync, rmSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
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

async function launchPlaywright(targetDir: string): Promise<SmokeBrowser | null> {
  try {
    const req = createRequire(join(targetDir, 'package.json'))
    const resolved = req.resolve('playwright')
    const pw = await import(pathToFileURL(resolved).href) as { chromium?: { launch(o: object): Promise<SmokeBrowser> }; default?: { chromium: { launch(o: object): Promise<SmokeBrowser> } } }
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

export async function runFlowSmoke(targetDir: string, opts: FlowSmokeOptions = {}): Promise<number> {
  const config = loadConfig(targetDir)
  const smoke = config?.smoke
  if (!smoke) {
    console.error(CONFIG_GUIDANCE)
    return 2
  }
  const baseUrl = opts.url ?? smoke.baseUrl
  const label = opts.label ?? process.env.YOKE_STORY ?? 'latest'
  const proofRel = join('.yoke', 'proof', label)
  const proofDir = join(targetDir, proofRel)
  rmSync(proofDir, { recursive: true, force: true }) // fresh evidence per run
  mkdirSync(proofDir, { recursive: true })
  const videoTmp = join(proofDir, '.video-tmp')

  const launch = opts.launch ?? launchPlaywright
  const browser = await launch(targetDir)
  if (!browser) {
    console.error(`Playwright not found in ${targetDir}. Install it: npm i -D playwright && npx playwright install chromium`)
    return 2
  }

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
      try {
        await page.screenshot({ path: join(proofDir, shotName), fullPage: true })
      } catch { /* keep the original reason */ }
      const video = page.video()
      await context.close()
      if (video) {
        try {
          const vpath = await video.path()
          if (reason) renameSync(vpath, join(proofDir, `${safeName(flow.name)}.webm`))
          else rmSync(vpath, { force: true })
        } catch { /* video is best-effort evidence */ }
      }
      if (reason) {
        console.log(`✘ ${flow.name} — ${reason} (screenshot + video saved under ${proofRel})`)
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
```

- [ ] **Step 4: Run** — `npx vitest run tests/smoke` → PASS. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit** — `feat(smoke): yoke flow-smoke core — screenshots always, video on failure`

---

### Task 3: Loop linkage (`YOKE_STORY`) + gitignore `.yoke/proof/`

**Files:**
- Modify: `src/loop/loop.ts` (both verify call sites, near lines 88 and 138)
- Modify: `src/retrofit/gitignore.ts`
- Test: the existing loop test file that exercises `runLoop` with a fake verifier (find with Glob `tests/loop/loop*.test.ts`); `tests/retrofit/gitignore.test.ts`

- [ ] **Step 1: Write the failing tests.** In the loop test file, using its existing fake-runner/fake-git helpers:

```ts
it('exposes the story id to the verifier via YOKE_STORY and unsets it after', () => {
  let seen: string | undefined
  const verify = (dir: string) => { seen = process.env.YOKE_STORY; return { passed: true, summary: 'ok' } }
  // arrange a single-story PRD exactly like the existing happy-path test, then runLoop with this verifier
  // ... existing setup ...
  expect(seen).toBe('S1')
  expect(process.env.YOKE_STORY).toBeUndefined()
})
```

In `tests/retrofit/gitignore.test.ts`: extend the explicit-lines assertion so `.yoke/proof/` is one of the ensured lines (same pattern as the `.yoke/loop.lock` case from Baustein K).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.** In `src/retrofit/gitignore.ts`, append `'.yoke/proof/'` to `YOKE_IGNORE_LINES`. In `src/loop/loop.ts`, wrap BOTH verify call sites:

```ts
reporter.phase('verifying')
process.env.YOKE_STORY = story.id
let verdict
try {
  verdict = opts.verify(wt)          // second site: opts.verify(opts.targetDir)
} finally {
  delete process.env.YOKE_STORY
}
```

(Keep everything downstream of `verdict` unchanged.)

- [ ] **Step 4: Run** — `npx vitest run tests/loop tests/retrofit` → PASS.

- [ ] **Step 5: Commit** — `feat(loop): label flow-smoke proofs per story via YOKE_STORY; gitignore .yoke/proof/`

---

### Task 4: CLI wiring (async main) + usage

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Make `main` awaitable.** Change the signature to `function main(argv: string[]): number | Promise<number>` and the isMain guard to:

```ts
const isMain = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false
if (isMain) {
  process.exit(await main(process.argv.slice(2)))
}
```

(Top-level await is valid here — ESM.) Add the import and the case:

```ts
import { runFlowSmoke } from './smoke/command.js'
```

```ts
case 'flow-smoke': {
  const targetDir = rest.find(a => !a.startsWith('-')) ?? '.'
  const url = rest.find(a => a.startsWith('--url='))?.slice('--url='.length)
  const label = rest.find(a => a.startsWith('--label='))?.slice('--label='.length)
  return runFlowSmoke(targetDir, { url, label })
}
```

Extend the `default` usage string with `flow-smoke [dir] [--url=<baseUrl>] [--label=<name>]`.

- [ ] **Step 2: Verify** — `npx tsc --noEmit` clean; `npm run build` succeeds; `node dist/cli.js flow-smoke` in the yoke repo itself prints the config guidance and exits 2 (yoke has no smoke section — expected).

- [ ] **Step 3: Commit** — `feat(cli): wire yoke flow-smoke (async main)`

---

### Task 5: Canon skill update + attribution

**Files:**
- Modify: `canon/skills/visual-verification/SKILL.md`
- Modify: `canon/skills/ATTRIBUTION.md`

- [ ] **Step 1: Rewrite sections 2 and 3 of the skill** (keep section 1 and the frontmatter's spirit; update the description to mention the built-in command). New content for the body after section 1:

```markdown
## 2. Flow-smoke with the built-in gate

Configure the key user flows once in `.yoke/config.yaml`:

```yaml
smoke:
  baseUrl: http://localhost:3000
  flows:
    - name: home
      path: /
      landmark: "main h1"
    - name: login
      path: /login
      landmark: "form"
```

Then chain the built-in gate in `verify.command`:

```
<typecheck> && <unit tests> && yoke design-scan . && yoke flow-smoke .
```

`yoke flow-smoke` loads each route against the running dev server, waits for the landmark,
fails on any console error, and **always** saves a screenshot to `.yoke/proof/<story>/`
(the loop labels the folder with the current story id via `YOKE_STORY`; standalone runs use
`latest`, or pass `--label=`). Requires Playwright in the project:
`npm i -D playwright && npx playwright install chromium`. Start the dev server before verify
(e.g. via `start-server-and-test`).

## 3. Video only when necessary

`yoke flow-smoke` records video per flow and keeps it **only on failure**
(`.yoke/proof/<story>/<flow>.webm`). When a flow goes red: watch that clip first, then use the
wired Playwright MCP to reproduce interactively. Never record every run manually — the gate
already handles the failure case.

## Rule

Green pipeline = types + units + no design-slop over budget + every flow renders without
console errors, with a screenshot to prove it. Only then is the story actually done.
```

Update the frontmatter `description` to: `Use for any UI/web project — make the verify gate cover more than unit tests by composing a pipeline (types → unit → design-scan → flow-smoke) and running the built-in yoke flow-smoke gate (landmark + zero console errors + screenshot proof to .yoke/proof/<story>/, video kept on failure). Catches the unwired-page / runtime-crash / AI-slop bugs unit tests miss.`

- [ ] **Step 2: Extend the gstack entry in `canon/skills/ATTRIBUTION.md`** — add to the existing gstack bullet (do not create a second entry): browser-QA-as-gate idea (`/qa`) natively re-implemented as `yoke flow-smoke` with a proof-artifact contract; no code copied.

- [ ] **Step 3: Run** — `npx vitest run tests/canon` → PASS (real-canon validates the skill file).

- [ ] **Step 4: Commit** — `docs(canon): visual-verification uses built-in flow-smoke; attribution`

---

### Task 6: README + final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README updates** (user rule: README moves with every change):
  - New section **`yoke flow-smoke`** next to the design-scan section: config example, proof contract (screenshots always → `.yoke/proof/<label>/`, video kept on failure, loop labels per story via `YOKE_STORY`), exit codes 0/1/2, Playwright-in-target-project requirement, `--url`/`--label` flags.
  - Extend the verify-pipeline example(s) to `... && yoke design-scan . && yoke flow-smoke .`.
  - Highlights list: add a line about story-level visual proofs ("done, with a photo").
  - Update the test count badge + mentions to the real number from Step 2.

- [ ] **Step 2: Full verification:**

```
npx tsc --noEmit
npx vitest run --reporter=json --outputFile=.yoke-test.json
node -e "const r=require('./.yoke-test.json'); console.log('success', r.success, 'total', r.numTotalTests, 'failed', r.numFailedTests)"
npm run build
node dist/cli.js validate canon
```

Delete `.yoke-test.json`. All green, canon valid.

- [ ] **Step 3: Commit** — `docs(readme): flow-smoke gate + proof contract; test count`

---

## Self-review (done at plan time)

- Spec coverage: Part 1→Task 1, Part 2→Task 2, Part 3→Task 3, Part 4→Task 4, Part 5→Task 5, README→Task 6. Spec's `browser` seam intentionally generalized to `launch` (declared deviation, testable exit-2).
- Placeholder scan: all steps carry complete code or exact edit locations; the two "reuse existing helpers" test steps name the discovery mechanism (Glob patterns) and the exact assertions.
- Type consistency: `SmokeBrowser`/`SmokeContext`/`SmokePage`/`FlowSmokeOptions.launch` identical across Tasks 2 and the tests; `SmokeConfig`/`SmokeFlow` from Task 1 consumed in Task 2 via `loadConfig`.
