# Baustein M — `yoke flow-smoke`: built-in browser gate with screenshot/video proofs

Date: 2026-07-02
Status: approved (design delegated by user; proof concept approved in conversation: screenshots
always, video on failure, `.yoke/proof/` storage, loop links proofs to stories)

## Problem

The verify gate is code-only unless an agent hand-rolls a Playwright smoke (the
`visual-verification` skill teaches it, but nothing enforces or standardizes it). A story can
pass unit tests and design-scan yet ship a blank page, an unwired route, or a runtime console
error. And when a story IS done, there is no visual evidence — "done with a photo" is the answer
to the loudest agentic-coding pain point ("agent says done, but it isn't").

## Goal

A built-in, mechanical browser gate that any project can add to `verify.command`:

```
yoke flow-smoke [dir] [--url=<baseUrl>] [--label=<name>]
```

For every configured flow: load the route, optionally wait for a landmark selector, assert zero
console/page errors, and **always** save a screenshot to `.yoke/proof/<label>/<flow>.png`.
Record video per flow but **keep it only on failure** (`<flow>.webm`). Exit 0 = all flows green
(chainable in `verify.command`), 1 = failures, 2 = not runnable (no config / no playwright).

## Part 1: Config schema

Extend `YokeConfigSchema` (src/retrofit/config.ts) with an optional `smoke` section:

```yaml
smoke:
  baseUrl: http://localhost:3000
  flows:
    - name: home
      path: /
      landmark: "main h1"        # optional CSS selector
    - name: login
      path: /login
```

Zod: `smoke: z.object({ baseUrl: z.string().min(1), flows: z.array(z.object({ name: z.string().min(1), path: z.string().min(1), landmark: z.string().optional() })).min(1) }).optional()` and the matching optional field on the `YokeConfig` interface. Existing configs (no `smoke`) stay valid.

## Part 2: `runFlowSmoke` (src/smoke/command.ts)

`export async function runFlowSmoke(targetDir: string, opts: FlowSmokeOptions = {}): Promise<number>`

Sequence:
1. Load config. No config file or no `smoke` section → print guidance (example YAML above) and
   exit **2**. `--url` overrides `baseUrl`.
2. Resolve Playwright **from the target project** (never a Yoke dependency):
   `createRequire(join(targetDir, 'package.json')).resolve('playwright')`, then dynamic
   `import(pathToFileURL(resolved).href)`. Resolution failure → print
   `Playwright not found in <dir>. Install it: npm i -D playwright && npx playwright install chromium`
   and exit **2**.
3. Proof dir: `.yoke/proof/<label>/` where label = `opts.label` ?? `process.env.YOKE_STORY` ??
   `'latest'`. Wipe the label dir before the run (`rmSync(recursive, force)` + mkdir) — each run
   is fresh evidence, no stale screenshots.
4. Launch chromium headless once; per flow, create a **new context** with
   `recordVideo: { dir: <proofDir>/.video-tmp }` and a page. Collect errors: `page.on('console')`
   with `type() === 'error'`, and `page.on('pageerror')`.
5. Per flow, in order (fail-fast per flow, continue to the next flow):
   - `page.goto(baseUrl + path, { waitUntil: 'load', timeout: 30_000 })`; a non-OK response
     (`!response.ok()`) is a failure (`HTTP <status>`).
   - if `landmark`: `page.waitForSelector(landmark, { timeout: 10_000 })`; timeout → failure
     (`landmark "<sel>" not found`).
   - collected errors non-empty → failure (`N console error(s): <first, truncated 200 chars>`).
   - **always** `page.screenshot({ path: <proofDir>/<flow.name>.png, fullPage: true })` — also on
     failure (the failure screenshot IS the evidence), inside try/catch (a crashed page must not
     mask the original failure).
   - close context; then: flow failed → move its video to `<proofDir>/<flow.name>.webm`
     (`page.video().path()` after close); flow passed → delete the video file. Remove
     `.video-tmp` at the end.
6. Report per flow: `✔ home (screenshot: .yoke/proof/latest/home.png)` /
   `✘ login — 2 console error(s): ... (screenshot + video saved)`. Summary line
   `Flow-smoke: N/M flows green — proof: .yoke/proof/<label>/`.
7. Close the browser in a `finally`. Exit 0 all green, 1 any failure.

Injectable seam for tests: `opts.browser?: () => Promise<SmokeBrowser>` — a minimal structural
interface defined in the module:

```ts
export interface SmokePage {
  goto(url: string, opts?: object): Promise<{ ok(): boolean; status(): number } | null>
  waitForSelector(sel: string, opts?: object): Promise<unknown>
  screenshot(opts: { path: string; fullPage?: boolean }): Promise<unknown>
  on(event: 'console' | 'pageerror', handler: (arg: any) => void): void
  video(): { path(): Promise<string> } | null
}
export interface SmokeContext { newPage(): Promise<SmokePage>; close(): Promise<void> }
export interface SmokeBrowser {
  newContext(opts?: object): Promise<SmokeContext>
  close(): Promise<void>
}
```

The real path adapts Playwright's chromium to this interface; tests inject fakes (no Playwright
in Yoke's devDependencies — an fs-level fake writes marker files for "screenshot"/"video").

## Part 3: Loop linkage — proofs per story

- In `src/loop/loop.ts`, both verify call sites set `process.env.YOKE_STORY = story.id` before
  `opts.verify(...)` and delete it in a `finally`. A `yoke flow-smoke` inside `verify.command`
  then writes to `.yoke/proof/<story-id>/` automatically — every completed story has visual
  evidence, every blocked story has failure evidence (screenshot + video).
- `.yoke/proof/` joins `YOKE_IGNORE_LINES` (runtime artifact; must not break the clean-tree gate).

## Part 4: CLI + async main

- `main()` in src/cli.ts becomes `number | Promise<number>`-returning; the isMain block awaits it
  (top-level await, ESM). Existing sync cases are untouched.
- `case 'flow-smoke'`: `[dir]`, `--url=`, `--label=` → `return runFlowSmoke(targetDir, { url, label })`.
- Usage line gains `flow-smoke [dir] [--url=<baseUrl>] [--label=<name>]`.

## Part 5: Canon skill update

`canon/skills/visual-verification/SKILL.md`: replace the hand-rolled flow-smoke instruction with
the built-in — configure `smoke:` in `.yoke/config.yaml`, chain
`... && yoke design-scan . && yoke flow-smoke .` in `verify.command`; keep the Playwright-MCP
guidance for *debugging* a failed flow (watch the saved video first). Mention proofs land in
`.yoke/proof/<story>/`. Skill count stays 27 (content update, no new skill).

## Testing

- `tests/retrofit/config.test.ts` (extend): smoke section round-trips; config without smoke stays
  valid; invalid smoke (empty flows) rejected.
- `tests/smoke/command.test.ts` (fake browser):
  - exit 2 when no smoke config (message contains example);
  - exit 2 when playwright is unresolvable: call without `opts.browser` (the seam bypasses
    resolution) against a temp dir that has a smoke config but no playwright install;
  - green flow: screenshot file written under `.yoke/proof/latest/<name>.png`, video deleted, exit 0;
  - landmark timeout → exit 1, screenshot still written, video kept as `<name>.webm`;
  - console error collected → exit 1;
  - non-OK response → exit 1;
  - label resolution: `--label` beats `YOKE_STORY` env beats `latest`;
  - proof dir wiped between runs (stale file gone);
  - one failing flow does not stop later flows (both reported).
- `tests/loop/*`: one test that a fake verifier observes `process.env.YOKE_STORY === story.id`
  during verify and that it is unset afterwards (both normal and `--isolate` paths if cheap;
  normal path suffices).
- `tests/retrofit/gitignore.test.ts`: `.yoke/proof/` ensured.

## Non-goals

- No dev-server startup/readiness management (`start-server-and-test` and friends exist; the
  skill documents chaining). A connection-refused goto is an ordinary flow failure.
- No visual diffing/pixel comparison, no multi-browser matrix, no video-always mode (token/disk
  cost; Ebene C in the Baustein-I backlog stays opt-in future work).
- Playwright stays a target-project dependency, never Yoke's.

## Attribution

Browser-QA-as-gate idea: gstack `/qa` (MIT © Garry Tan), natively re-implemented cross-agent with
a proof-artifact contract; no code copied. Extend the existing ATTRIBUTION.md gstack entry.
