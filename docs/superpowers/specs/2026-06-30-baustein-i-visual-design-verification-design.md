# Baustein I — Visual & Design Verification

**Status:** Design approved 2026-06-30 (autonomous)
**Component:** Yoke (🐂)
**Relates to:** [[harness-build-progress]], [[readme-always-update]]
**Inspired by:** [vibecoded-design-tells](https://github.com/JCarterJohnson/vibecoded-design-tells) (MIT © 2026 Carter Johnson) — a data-ranked study of the visual "tells" of AI-generated UIs. Yoke implements the *idea* natively in TypeScript and credits the research; no code or data is copied.

## Problem & Goal

Yoke's verify gate is **code-only** (`tsc` + unit/component tests). It does not check that the UI is **visually sound** (free of generic AI-slop design) or that **user flows actually work end-to-end**. Evidence: in the real NewMarket run, integration/visual bugs (unwired auth pages, a seed id-collision, an old "purple #6c5ce7 dark theme" — itself a classic AI-slop tell) slipped past the unit-test gate and were only caught by a later manual QA sweep.

**Goal:** add a **visual & design verification layer** that plugs into the existing verify model (so it's gated, not advisory) and is honest about cost:
1. **Mechanical:** a static **design-slop scanner** (`yoke design-scan`) that flags the high-signal AI-slop tells and gates on exit code.
2. **Methodology:** two canon skills — `unslop-ui` (the design rubric) and `visual-verification` (compose a verify pipeline: types + unit + design-scan + a Playwright flow-smoke; capture video only on failure).

Both integrate through one idea: **the project's `verify.command` becomes a pipeline**, and Baustein-H's verify-as-truth makes those gates authoritative.

## Key Decisions (locked)

| Decision | Choice |
|---|---|
| Design-slop detection | A **TS-native** scanner built into the `yoke` CLI (`yoke design-scan`), not a port of the upstream Python; high-precision static heuristics |
| Gate model | Exit non-zero when the weighted tell-score exceeds `--max` (default **4**); `--report` lists without failing |
| Flow / video | **Methodology, not CLI** — the agent drives the wired Playwright MCP per the `visual-verification` skill. Yoke gates + guides; it does not embed a browser. Video capture is **opt-in, on failure only** (token-aware). |
| Skills | `unslop-ui` (rubric) + `visual-verification` (pipeline + flow-smoke + video-on-failure) → all 3 agents |
| Attribution | Credit vibecoded-design-tells (MIT) in `ATTRIBUTION.md` + README + the skill |
| Canon count | 24 → **26** skills |
| Out of scope (YAGNI) | Embedding Playwright/a browser in the Yoke CLI; structural-layout detection ("centered hero + 3 cards") — left to the rubric + agent eye; auto-fixing slop (the agent fixes, guided by the skill) |

## Architecture

### 1. `src/scan/design.ts` (new) — the static scanner
Pure + unit-testable. Walks the project's source and scores AI-slop tells.

```ts
export interface Tell { name: string; weight: number; test: (line: string) => boolean; hint: string }
export interface Finding { file: string; line: number; tell: string; hint: string; text: string }
export interface ScanResult { findings: Finding[]; score: number }

export const TELLS: Tell[]            // the curated tell set (below)
export function scanText(text: string, tells?: Tell[]): { line: number; tell: Tell; text: string }[]
export function scanDir(dir: string, tells?: Tell[]): ScanResult   // walks files, aggregates
```

**Curated high-precision tells** (each match adds `weight` to the score):

| Tell | weight | matches (case-insensitive) | hint |
|---|---|---|---|
| `ai-purple` | 2 | hex `#6c5ce7\|#7c3aed\|#8b5cf6\|#a855f7\|#9333ea`, or Tailwind `(from\|via\|to)-(purple\|violet\|fuchsia)-(4\|5\|6\|7)00` | AI-purple is the #1 vibecoded tell — choose a real brand color |
| `gradient-clip-text` | 2 | a line containing both `bg-clip-text` and `text-transparent`, or CSS `-webkit-background-clip:\s*text` near a gradient | gradient hero text reads as AI-slop — solid color + weight instead |
| `neon-glow` | 2 | Tailwind `(shadow\|drop-shadow)-\[0_0_`, or CSS `box-shadow:[^;]*0\s+0\s+\d{2,}px` with a color | neon glow is a tell — use subtle, neutral elevation |
| `gradient-overload` | 1 | `bg-gradient-to-` or CSS `linear-gradient(` | gradients everywhere flatten hierarchy — use them sparingly |
| `emoji-icon` | 1 | an emoji (unicode pictographic) inside a `.tsx/.jsx` line that also contains `<button`, `<a `, `aria-hidden`, or a JSX `>…<` icon slot | emoji-as-icons is a tell — use a real icon set |

File walk: extensions `.css .scss .tsx .jsx .ts .js .html .vue .svelte .astro`; skip `node_modules`, `dist`, `.next`, `build`, `.yoke`, `coverage`, `.git`. The tell set is the default but injectable (for tests). Heuristic by design — documented as high-signal, not exhaustive.

### 2. `src/cli.ts` — `yoke design-scan [dir] [--max=N] [--report]`
- Runs `scanDir(dir)`, prints findings grouped by tell as `file:line  <tell>  — <hint>`.
- `--report`: print + summary, **always exit 0** (advisory).
- default (gate): print + summary; **exit 1 if `score > max`** (default `max=4`), else 0. So a couple incidental matches pass; pervasive slop fails. Designed to sit in a verify pipeline.
- A small body extracted to `runDesignScan(dir, { max, report }): number` for testability.

### 3. `canon/skills/unslop-ui/SKILL.md` (new) — the rubric
Agent-facing. Lists the ranked tells (AI-purple gradients, gradient hero text, neon glow, emoji-as-icons, shadcn defaults left unchanged, "centered hero + three cards", homogeneous spacing) and how to fix each. Instructs: before finishing UI work, run `yoke design-scan .` and resolve findings; also apply the structural items the scanner can't see. Credits the research.

### 4. `canon/skills/visual-verification/SKILL.md` (new) — ties it together
Methodology for UI projects:
- **Compose the verify pipeline** so the loop gate covers more than units: `verify.command` chains types → unit tests → `yoke design-scan .` → a Playwright flow-smoke. (Baustein-H makes these authoritative.)
- **Flow-smoke via the wired Playwright MCP:** load the key routes against the dev server, assert they render and the console has **no errors**, screenshot each. This catches the "unwired page / runtime crash" bugs unit tests miss.
- **Video only when necessary:** capture a video of a flow **only on failure** (or when explicitly debugging a UX issue), then analyse it — keeps tokens down. Never record every run.

### 5. Wiring
- `canon/manifest.yaml`: add `unslop-ui` + `visual-verification` (kind: methodology).
- `canon/skills/ATTRIBUTION.md`: credit vibecoded-design-tells (MIT © Carter Johnson).
- `README.md` (**mandatory**): a "Visual & design verification" section (the scanner + the two skills + the pipeline idea), the catalog updated (24 → 26, methodology group +2), and the test-count badge synced.

## Data flow (gate)
```
verify.command =  tsc --noEmit  &&  vitest run  &&  yoke design-scan .  &&  <playwright flow-smoke>
                                                     │ exit 1 if slop-score > max
   loop verify (Baustein H: verify is the source of truth) ──► block on any red step
```

## Testing (subagent-driven TDD)
- **design.ts:** `scanText` flags each tell with correct line + weight; clean text → no findings; `scanDir` walks + skips ignored dirs + aggregates score; injected tell-set works; emoji/purple/clip/glow/gradient cases each covered; a known-clean snippet scores 0.
- **cli:** `runDesignScan` exits 1 when score > max, 0 when ≤ max, 0 always in `--report`; `--max` parsed; bad `--max` rejected.
- **canon:** `unslop-ui` + `visual-verification` registered; `validateCanon` stays zero-error; real-canon asserts both present.
- Full suite green; `tsc` clean.

## What this would have caught
- NewMarket's old **purple `#6c5ce7` dark theme** → `ai-purple` tell, scored, flagged before it shipped.
- **Unwired auth pages / runtime crashes** → the flow-smoke (render + no console errors) gate, not the unit tests.

## Non-goals (YAGNI)
- No browser embedded in the Yoke CLI (Playwright MCP is the agent's tool).
- No always-on video (opt-in, on failure).
- No auto-rewrite of slop (the agent fixes via the rubric).
- No structural-layout static detection (rubric + agent eye).
