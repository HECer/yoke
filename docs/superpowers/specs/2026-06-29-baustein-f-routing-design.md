# Baustein F — Skill Routing/Precedence + Review-Family Consolidation

**Status:** Design approved 2026-06-29
**Component:** Yoke (🐂)
**Relates to:** [[harness-build-progress]], [[readme-always-update]]

## Problem & Goal

The dev.to skills-stack article's #1 warning is **auto-invocation chaos**: when superpowers
(aggressive "1% chance → you MUST invoke") and gstack roles ("proactively suggest") are both
installed, overlapping skills compete on the same triggers, causing random/redundant selection.
Yoke's `canon/manifest.yaml` distinguishes `kind: methodology|role` but emits **no precedence or
routing** — nothing tells an agent which skill is canonical when several match.

The collision is concentrated in the review family. From the actual descriptions:

| Skill | Phase / angle | Status |
|---|---|---|
| `plan-eng-review` | plan-time, architecture | distinct ✓ |
| `plan-ceo-review` | plan-time, product/scope | distinct ✓ |
| `review` | **pre-merge, diff safety/structure** | collides ⚠ |
| `eng-review` (14-line stub) | **pre-merge, architecture/edge-cases/tests** | collides ⚠ |
| `requesting-code-review` | protocol: request a review | distinct ✓ |
| `receiving-code-review` | protocol: handle feedback | distinct ✓ |

The one real overlap is `eng-review` ↔ `review` — both "review the change before merge."

**Goal:** emit an explicit routing/precedence into every agent so auto-invocation resolves
deterministically, and collapse the `eng-review`/`review` overlap into one canonical pre-merge
review skill.

## Key Decisions (locked)

| Decision | Choice |
|---|---|
| Routing location | Authored prose section in `canon/AGENTS.md` (injected verbatim into all 3 agents) — NOT a new manifest field or generator |
| Precedence rule | Methodology (HOW) before role (perspective); process before implementation |
| Review collision | Fold `eng-review`'s checklist into `review`; **remove `eng-review`**; `review` becomes the single canonical pre-merge code review |
| Description hygiene | Sharpen the remaining review-family descriptions so triggers are phase-distinct, non-overlapping |
| Skill count | Canon 25 → **24** |
| README | Update the skills catalog (Roles 8→7, total 25→24) — **mandatory deliverable** |
| Out of scope (YAGNI) | No NLP trigger-collision validator (too fragile); no `priority` manifest field + generator (the `kind` distinction + authored prose suffices) |

## Architecture

### 1. Routing section in `canon/AGENTS.md`
A new "Skill routing & precedence" section appended to the baseline (which already covers
quality-first/stop-the-line/role-separation). It states three things:

1. **Precedence** — methodology skills decide *how* to work and take precedence over role skills
   (which add a perspective). Process before implementation.
2. **Canonical entrypoint per concern** — a small map, especially the review family:
   - Plan-time architecture review → `plan-eng-review`
   - Plan-time product/scope review → `plan-ceo-review`
   - **Pre-merge code review → `review`** (the single canonical one)
   - Requesting a review (dispatch a reviewer) → `requesting-code-review`
   - Handling review feedback → `receiving-code-review`
   - Build flow / order of operations → `workflow`
3. **Arbitration rule** — "These skills declare their own triggers aggressively; when several
   match the same task, this precedence + the most-specific-entrypoint rule decides. Don't run
   two skills that serve the same concern."

`canon/AGENTS.md` is copied verbatim by the Claude/Codex/Gemini planners and imported by the
generated `CLAUDE.md`/`GEMINI.md`, so this reaches all three agents with no generator change.

### 2. Review-family consolidation
- **`review`** absorbs `eng-review`'s checklist: in addition to diff safety (SQL, trust
  boundaries, side effects), it now also covers architecture fit, edge cases, test coverage, and
  performance — the engineering-manager angle. One canonical pre-merge review.
- **`eng-review` removed**: delete `canon/skills/eng-review/` and its `manifest.yaml` entry.
- **Descriptions sharpened**: each review-family skill's description names its phase explicitly
  so triggers don't overlap (plan-time vs pre-merge vs protocol).

### 3. Manifest + validator
- Remove the `eng-review` entry from `canon/manifest.yaml`.
- `validateCanon` must stay green (it validates that each listed skill has a dir + frontmatter;
  removing the entry + dir keeps it consistent). No validator code change required unless a test
  hard-codes the skill list.

### 4. README (mandatory)
Update the skills catalog: remove the `eng-review` row, move its purpose into the `review` row,
change the Roles count 8→7 and the total 25→24. Per the standing rule, the README must reflect
what shipped.

## Data flow (how routing reaches an agent)
```
canon/AGENTS.md (routing section)
   └─ planClaude → AGENTS.md + CLAUDE.md (@AGENTS.md import)   → Claude reads precedence
   └─ planCodex  → AGENTS.md (Codex reads it natively)          → Codex reads precedence
   └─ planGemini → GEMINI.md + .gemini/settings (AGENTS.md ctx) → Gemini reads precedence
```

## Testing
- `tests/canon/real-canon.test.ts`: assert `eng-review` is NOT in the manifest; assert
  `canon/AGENTS.md` contains the routing section (e.g. a stable heading + the "Pre-merge code
  review → `review`" line); `validateCanon('canon')` stays zero-error.
- `tests/retrofit/plan-dispatch.test.ts` (or planners tests): the emitted skill set no longer
  includes `eng-review`; total skill count reflects 24. Adjust any hard-coded count.
- `review` skill still validates (frontmatter intact after the checklist merge).
- Full suite green; `tsc` clean.

## Non-goals (YAGNI)
- No automated trigger-collision detection.
- No new manifest `priority` field or routing generator.
- No change to plan-ceo-review / plan-eng-review / requesting- / receiving-code-review bodies
  beyond description sharpening.
