# Baustein I — Visual & Design Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a static AI-slop **design scanner** (`yoke design-scan`, gated on exit code) plus two canon skills (`unslop-ui`, `visual-verification`) so the loop's verify gate can cover visual/design quality and user-flow smoke, not just unit tests.

**Architecture:** A pure `src/scan/design.ts` (curated tell set + `scanText`/`scanDir`) wired to a `yoke design-scan` CLI command (`runDesignScan`), plus markdown canon skills + manifest/attribution/README. No browser is embedded — flow-smoke/video is methodology in the `visual-verification` skill using the already-wired Playwright MCP.

**Tech Stack:** Node.js + TypeScript (ESM, `.js` specifiers, strict), vitest. `npx vitest run`, `npx tsc --noEmit`.

---

## File Structure

| File | Change |
|------|--------|
| `src/scan/design.ts` (create) | `Tell`/`Finding`/`ScanResult` types, `TELLS`, `scanText`, `scanDir` |
| `src/cli.ts` (modify) | `runDesignScan` + `design-scan` case + usage |
| `canon/skills/unslop-ui/SKILL.md` (create) | design-tells rubric |
| `canon/skills/visual-verification/SKILL.md` (create) | verify-pipeline + flow-smoke + video-on-failure |
| `canon/manifest.yaml` (modify) | register both skills |
| `canon/skills/ATTRIBUTION.md` (modify) | credit vibecoded-design-tells (MIT) |
| `tests/scan/design.test.ts`, `tests/scan/design-cli.test.ts` (create) | scanner + CLI tests |
| `tests/canon/real-canon.test.ts` (modify) | assert both skills registered |
| `README.md` (modify) | Visual-verification section + catalog 24→26 + badge sync |

---

### Task 1: the static scanner — `src/scan/design.ts`

**Files:** Create `src/scan/design.ts`; Test `tests/scan/design.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/scan/design.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanText, scanDir, TELLS } from '../../src/scan/design.js'

describe('scanText', () => {
  it('flags AI-purple hex and tailwind purple gradients', () => {
    expect(scanText('color: #6c5ce7;').some(m => m.tell.name === 'ai-purple')).toBe(true)
    expect(scanText('<div class="bg-gradient-to-r from-purple-500 to-violet-600">').some(m => m.tell.name === 'ai-purple')).toBe(true)
  })
  it('flags gradient hero text (clip-text + transparent)', () => {
    expect(scanText('<h1 class="bg-clip-text text-transparent bg-gradient-to-r">').some(m => m.tell.name === 'gradient-clip-text')).toBe(true)
  })
  it('flags neon glow', () => {
    expect(scanText('class="shadow-[0_0_20px_rgba(0,255,255,0.7)]"').some(m => m.tell.name === 'neon-glow')).toBe(true)
    expect(scanText('box-shadow: 0 0 40px #0ff;').some(m => m.tell.name === 'neon-glow')).toBe(true)
  })
  it('flags gradient overload', () => {
    expect(scanText('background: linear-gradient(90deg, #fff, #000);').some(m => m.tell.name === 'gradient-overload')).toBe(true)
  })
  it('does not flag clean, conventional styles', () => {
    expect(scanText('class="rounded-lg border bg-white p-4 text-slate-800"')).toEqual([])
    expect(scanText('color: #1d1d1f; background: #f5f5f7;')).toEqual([])
  })
  it('counts at most one finding per tell per line', () => {
    const m = scanText('from-purple-500 via-purple-600 to-purple-700')
    expect(m.filter(x => x.tell.name === 'ai-purple')).toHaveLength(1)
  })
})

describe('scanDir', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-scan-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('walks source files, aggregates a weighted score, and records file:line', () => {
    writeFileSync(join(dir, 'a.css'), 'h1 { color: #6c5ce7; }\n')               // ai-purple weight 2
    writeFileSync(join(dir, 'b.tsx'), '\n<span class="shadow-[0_0_10px_#f0f]" />') // neon-glow weight 2, line 2
    const res = scanDir(dir)
    expect(res.score).toBe(4)
    expect(res.findings.some(f => f.file.endsWith('a.css') && f.line === 1 && f.tell === 'ai-purple')).toBe(true)
    expect(res.findings.some(f => f.file.endsWith('b.tsx') && f.line === 2 && f.tell === 'neon-glow')).toBe(true)
  })
  it('skips node_modules / dist / .yoke and non-source extensions', () => {
    mkdirSync(join(dir, 'node_modules'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'x.css'), 'color:#6c5ce7;')
    writeFileSync(join(dir, 'readme.md'), 'a #6c5ce7 mention')
    expect(scanDir(dir).score).toBe(0)
  })
  it('accepts an injected tell set', () => {
    writeFileSync(join(dir, 'a.css'), 'foo')
    const tells = [{ name: 'foo', weight: 5, test: (l: string) => l.includes('foo'), hint: 'h' }]
    expect(scanDir(dir, tells).score).toBe(5)
  })
})

it('TELLS is the curated non-empty default set', () => {
  expect(TELLS.map(t => t.name)).toEqual(
    expect.arrayContaining(['ai-purple', 'gradient-clip-text', 'neon-glow', 'gradient-overload']),
  )
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/scan/design.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** `src/scan/design.ts`

```typescript
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

export interface Tell {
  name: string
  weight: number
  test: (line: string) => boolean
  hint: string
}
export interface Match { line: number; tell: Tell; text: string }
export interface Finding { file: string; line: number; tell: string; hint: string; text: string }
export interface ScanResult { findings: Finding[]; score: number }

const AI_PURPLE_HEX = /#(6c5ce7|7c3aed|8b5cf6|a855f7|9333ea)\b/i
const AI_PURPLE_TW = /\b(from|via|to)-(purple|violet|fuchsia)-(4|5|6|7)00\b/i
const NEON_TW = /\b(shadow|drop-shadow)-\[0_0_/i
const NEON_CSS = /box-shadow:[^;]*\b0\s+0\s+\d{2,}px/i
const EMOJI = /\p{Extended_Pictographic}/u
const JSX_ICON_CTX = /<button|<a\s|aria-hidden|(icon|emoji)/i

export const TELLS: Tell[] = [
  { name: 'ai-purple', weight: 2, hint: 'AI-purple is the #1 vibecoded tell — pick a real brand color',
    test: (l) => AI_PURPLE_HEX.test(l) || AI_PURPLE_TW.test(l) },
  { name: 'gradient-clip-text', weight: 2, hint: 'Gradient hero text reads as AI-slop — use a solid color + weight',
    test: (l) => (/bg-clip-text/.test(l) && /text-transparent/.test(l)) || /-webkit-background-clip:\s*text/i.test(l) },
  { name: 'neon-glow', weight: 2, hint: 'Neon glow is a tell — use subtle, neutral elevation',
    test: (l) => NEON_TW.test(l) || NEON_CSS.test(l) },
  { name: 'gradient-overload', weight: 1, hint: 'Gradients everywhere flatten hierarchy — use them sparingly',
    test: (l) => /bg-gradient-to-/.test(l) || /linear-gradient\(/i.test(l) },
  { name: 'emoji-icon', weight: 1, hint: 'Emoji-as-icons is a tell — use a real icon set',
    test: (l) => EMOJI.test(l) && JSX_ICON_CTX.test(l) },
]

// One match per (line, tell) at most, so a line with three purple classes counts once.
export function scanText(text: string, tells: Tell[] = TELLS): Match[] {
  const matches: Match[] = []
  const lines = text.split(/\r?\n/)
  lines.forEach((line, i) => {
    for (const tell of tells) {
      if (tell.test(line)) matches.push({ line: i + 1, tell, text: line.trim().slice(0, 200) })
    }
  })
  return matches
}

const EXT = new Set(['.css', '.scss', '.tsx', '.jsx', '.ts', '.js', '.html', '.vue', '.svelte', '.astro'])
const SKIP = new Set(['node_modules', 'dist', '.next', 'build', '.yoke', 'coverage', '.git', 'out'])

function walk(dir: string, acc: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    let s
    try { s = statSync(full) } catch { continue }
    if (s.isDirectory()) {
      if (!SKIP.has(entry)) walk(full, acc)
    } else if (EXT.has(extname(entry).toLowerCase())) {
      acc.push(full)
    }
  }
}

export function scanDir(dir: string, tells: Tell[] = TELLS): ScanResult {
  const files: string[] = []
  walk(dir, files)
  const findings: Finding[] = []
  let score = 0
  for (const file of files) {
    let text: string
    try { text = readFileSync(file, 'utf8') } catch { continue }
    for (const m of scanText(text, tells)) {
      findings.push({ file, line: m.line, tell: m.tell.name, hint: m.tell.hint, text: m.text })
      score += m.tell.weight
    }
  }
  return { findings, score }
}
```

- [ ] **Step 4: Run it green** — `npx vitest run tests/scan/design.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/scan/design.ts tests/scan/design.test.ts
git commit -m "feat(scan): static AI-slop design-tell scanner (scanText/scanDir)"
```

---

### Task 2: `yoke design-scan` CLI

**Files:** Modify `src/cli.ts`; Test `tests/scan/design-cli.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/scan/design-cli.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runDesignScan } from '../../src/cli.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-dscli-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('runDesignScan', () => {
  it('exits 0 when the slop score is within --max', () => {
    writeFileSync(join(dir, 'a.css'), 'color: #6c5ce7;') // score 2
    expect(runDesignScan(dir, { max: 4, report: false })).toBe(0)
  })
  it('exits 1 when the slop score exceeds --max', () => {
    writeFileSync(join(dir, 'a.css'), 'color:#6c5ce7; box-shadow: 0 0 40px #0ff; background: linear-gradient(#fff,#000);') // 2+2+1 = 5
    expect(runDesignScan(dir, { max: 4, report: false })).toBe(1)
  })
  it('always exits 0 in --report mode even with findings', () => {
    writeFileSync(join(dir, 'a.css'), 'color:#6c5ce7; box-shadow: 0 0 40px #0ff;')
    expect(runDesignScan(dir, { max: 0, report: true })).toBe(0)
  })
  it('exits 0 on a clean project', () => {
    writeFileSync(join(dir, 'a.css'), 'color:#1d1d1f;')
    expect(runDesignScan(dir, { max: 4, report: false })).toBe(0)
  })
})
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run tests/scan/design-cli.test.ts` → FAIL (`runDesignScan` not exported).

- [ ] **Step 3: Implement** in `src/cli.ts`

Add the import (with the other imports):
```typescript
import { scanDir } from './scan/design.js'
```
Add the exported function (near `runValidate`):
```typescript
export function runDesignScan(targetDir: string, opts: { max: number; report: boolean }): number {
  const { findings, score } = scanDir(targetDir)
  for (const f of findings) {
    console.log(`  ${f.file}:${f.line}  ${f.tell}  — ${f.hint}`)
  }
  const label = `Design scan: score ${score} (${findings.length} tell${findings.length === 1 ? '' : 's'}), budget ${opts.max}`
  if (opts.report) { console.log(`${label} — report only`); return 0 }
  if (score > opts.max) { console.log(`${label} — ✗ over budget`); return 1 }
  console.log(`${label} — ✓`)
  return 0
}
```
Add a `case` in `main`'s switch (before `default`):
```typescript
    case 'design-scan': {
      const targetDir = rest.find(a => !a.startsWith('-')) ?? '.'
      const report = rest.includes('--report')
      const maxArg = rest.find(a => a.startsWith('--max='))
      const max = maxArg ? Number(maxArg.slice('--max='.length)) : 4
      if (!Number.isFinite(max) || max < 0) { console.error(`Invalid --max value: ${maxArg}`); return 1 }
      return runDesignScan(targetDir, { max, report })
    }
```
Append ` | design-scan [dir] [--max=N] [--report]` to the top-level `default` usage string.

- [ ] **Step 4: Run green + full suite + types** — `npx vitest run && npx tsc --noEmit` → PASS, clean.

- [ ] **Step 5: Commit**
```bash
git add src/cli.ts tests/scan/design-cli.test.ts
git commit -m "feat(cli): yoke design-scan — gate on AI-slop design score"
```

---

### Task 3: canon skills + manifest + attribution

**Files:** Create `canon/skills/unslop-ui/SKILL.md`, `canon/skills/visual-verification/SKILL.md`; Modify `canon/manifest.yaml`, `canon/skills/ATTRIBUTION.md`; Test `tests/canon/real-canon.test.ts`

- [ ] **Step 1: Write the failing test** — add to `tests/canon/real-canon.test.ts` (inside `describe('real canon')`):
```typescript
  it('registers the visual verification skills', () => {
    const manifest = loadManifest(join(repoRoot, 'canon', 'manifest.yaml'))
    expect(manifest.skills.some(s => s.id === 'unslop-ui')).toBe(true)
    expect(manifest.skills.some(s => s.id === 'visual-verification')).toBe(true)
  })
```
Run `npx vitest run tests/canon/real-canon.test.ts` → FAIL.

- [ ] **Step 2: Create `canon/skills/unslop-ui/SKILL.md`**
```markdown
---
name: unslop-ui
description: Use when building or reviewing any UI — detect and remove the visual "tells" of AI-generated/vibecoded design (AI-purple gradients, gradient hero text, neon glow, emoji-as-icons, untouched shadcn defaults, centered-hero-plus-three-cards) so the result looks deliberately designed, not machine-default.
---

# Un-slop the UI

AI-built UIs are "recognizable on sight" — a homogeneous look from a handful of default choices.
Before finishing UI work, remove these tells. Run `yoke design-scan .` for the statically
detectable ones, then apply judgement for the structural ones the scanner can't see.

## The ranked tells (and the fix)

- **AI-purple gradients** (the #1 tell) — purple/violet gradients and `#6c5ce7`-family accents.
  → Choose one real brand color with intent; avoid purple-by-default.
- **Gradient hero text** — `bg-clip-text text-transparent` rainbow headings.
  → Solid color + type weight/scale for emphasis.
- **Neon glow** — `0 0 Npx` colored box-shadows / `shadow-[0_0_...]`.
  → Subtle, neutral elevation (small offset, low blur, low opacity).
- **Emoji-as-icons** — 🚀✨🔥 in buttons/nav/feature lists.
  → A real icon set (lucide, etc.), consistent stroke + size.
- **Untouched shadcn/Tailwind defaults** — default radius, default slate everywhere.
  → Set deliberate tokens (radius, spacing scale, one accent) so it doesn't look boilerplate.
- **Centered hero + three feature cards** — the canonical AI landing layout.
  → Vary rhythm: asymmetry, a real product shot, content density that fits the product.
- **Homogeneous spacing / no hierarchy** — everything the same size and gap.
  → Establish a type scale and spacing rhythm; make the primary action obviously primary.

## Rule

Treat `yoke design-scan .` as a gate (it exits non-zero over budget). Fix findings, then
eyeball the structural tells above. Distinctive, intentional > generic-but-safe.

*Rubric informed by the MIT-licensed research in [vibecoded-design-tells](https://github.com/JCarterJohnson/vibecoded-design-tells) (© Carter Johnson). Yoke implements the idea natively; no code/data copied.*
```

- [ ] **Step 3: Create `canon/skills/visual-verification/SKILL.md`**
```markdown
---
name: visual-verification
description: Use for any UI/web project — make the verify gate cover more than unit tests by composing a pipeline (types → unit → design-scan → flow-smoke) and driving a Playwright flow-smoke (render + no console errors + screenshot); capture video only on failure. Catches the unwired-page / runtime-crash / AI-slop bugs unit tests miss.
---

# Visual verification

Unit tests don't see a blank page, an unwired route, a runtime console error, or AI-slop design.
Make the loop's gate catch them by widening `verify`, since the loop trusts verify as truth.

## 1. Compose the verify pipeline

Set `verify.command` (in `.yoke/config.yaml`) to chain, fail-fast:

```
<typecheck> && <unit tests> && yoke design-scan . && <flow-smoke>
```
e.g. `tsc --noEmit && vitest run && yoke design-scan . && npm run smoke`. Any red step blocks the story.

## 2. Flow-smoke with the wired Playwright MCP

For the key user flows (home, signup/login, the primary action, checkout), against the running
dev server:
- load the route, assert it renders the expected landmark, and assert the **console has no errors**;
- take a screenshot of each for the record.

This is what catches "the page is wired wrong / it crashes on load" — the class of bug unit tests pass straight through.

## 3. Video only when necessary

Recording + analysing video is token-heavy. Capture a video of a flow **only when a flow-smoke
fails** (or when explicitly debugging a UX problem), then analyse that clip. Never record every run.

## Rule

Green pipeline = types + units + no design-slop over budget + key flows render without console
errors. Only then is the story actually done.
```

- [ ] **Step 4: Register in `canon/manifest.yaml`** — add after the `workflow` entry (or with the methodology skills):
```yaml
  - { id: unslop-ui, path: skills/unslop-ui, kind: methodology }
  - { id: visual-verification, path: skills/visual-verification, kind: methodology }
```

- [ ] **Step 5: Credit in `canon/skills/ATTRIBUTION.md`** — append:
```markdown

## Design-tell research

`unslop-ui` and the `yoke design-scan` tell set are informed by
[vibecoded-design-tells](https://github.com/JCarterJohnson/vibecoded-design-tells)
(MIT © 2026 Carter Johnson) — a data-ranked study of AI-generated-UI tells. Yoke implements the
idea natively in TypeScript and copies no code or data.
```

- [ ] **Step 6: Run tests** — `npx vitest run tests/canon/` → PASS (both skills registered, `validateCanon` zero-error). Confirm the new skills' single-line descriptions pass validation.

- [ ] **Step 7: Commit**
```bash
git add canon/skills/unslop-ui canon/skills/visual-verification canon/manifest.yaml canon/skills/ATTRIBUTION.md tests/canon/real-canon.test.ts
git commit -m "feat(canon): unslop-ui + visual-verification skills (credit vibecoded-design-tells)"
```

---

### Task 4: README (mandatory)

**Files:** Modify `README.md`

- [ ] **Step 1: Add a "Visual & design verification" section** after the autonomous-loop/Context-layer sections:
```markdown
## 🎨 Visual & design verification

Unit tests don't catch a blank page, an unwired route, or generic AI-slop design. Yoke adds two things:

- **`yoke design-scan [dir]`** — a static scanner for the visual *tells* of AI-generated UIs
  (AI-purple gradients, gradient hero text, neon glow, emoji-as-icons, gradient overload). It
  scores findings and **exits non-zero over budget** (`--max`, default 4; `--report` to list only),
  so it drops straight into your verify pipeline.
- **`unslop-ui` + `visual-verification` skills** — the design rubric, plus how to compose a verify
  pipeline (`types → units → design-scan → Playwright flow-smoke`) and capture video *only on failure*.

Because the loop trusts **verify as the source of truth**, widening `verify.command` to include the
scanner and a flow-smoke makes visual quality a real gate — not an afterthought.

*Tell set informed by the MIT-licensed [vibecoded-design-tells](https://github.com/JCarterJohnson/vibecoded-design-tells) research.*
```

- [ ] **Step 2: Update the skills catalog** — in the "What's in the canon" section: change the heading count from **24** to **26**; change the **Process / methodology** group count from **(13)** to **(15)**; add two rows to that table:
```markdown
| `unslop-ui` | Detect & remove AI-slop design tells (purple gradients, neon glow, emoji-icons…) |
| `visual-verification` | Widen verify to flow-smoke + design-scan; video only on failure |
```

- [ ] **Step 3: Sync the test-count badge** — run the full suite to get the current count, then update the three `tests-NNN` references (badge line, the "✅ NNN tests" highlight, and `npm test # vitest (NNN tests)`) to the new number.

Run: `npx vitest run` → note the count; update README.

- [ ] **Step 4: Commit**
```bash
git add README.md
git commit -m "docs: visual & design verification section + catalog 24→26 + test count"
```

---

## Self-Review

**Spec coverage:** scanner (`scanText`/`scanDir`/`TELLS`) → Task 1; `yoke design-scan` gate → Task 2; `unslop-ui` + `visual-verification` skills + manifest + attribution → Task 3; README + catalog + counts → Task 4. Flow-smoke/video are methodology in `visual-verification` (no browser embedded) per the spec.

**Placeholder scan:** No TBD/TODO; every code/markdown step is complete. The tell regexes and weights are concrete and match the test expectations (ai-purple 2, neon 2, clip 2, gradient 1, emoji 1).

**Type consistency:** `Tell`/`Match`/`Finding`/`ScanResult`, `scanText(text, tells?)`, `scanDir(dir, tells?)`, `TELLS`, `runDesignScan(dir, {max, report})` are defined once and used consistently. The CLI default `--max=4` matches the spec and the CLI tests (score 5 > 4 → exit 1; score 2 ≤ 4 → exit 0).

**Counts:** manifest gains 2 skills (24→26); README heading 26 and methodology group 13→15 (the README groups by provenance — the two new Yoke-authored methodology skills go in the Process/methodology group, keeping 13+2=15 there; 15+7 roles+4 yoke-native… note: re-verify the README's own grouping math sums to 26 when editing, adjusting whichever group label the new rows live under).
```
