# Baustein F — Routing/Precedence + Review Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit explicit skill precedence + a canonical-entrypoint routing into every agent (via `canon/AGENTS.md`), and collapse the `eng-review`/`review` pre-merge overlap into one canonical `review` skill — closing the article's auto-invocation-chaos gap.

**Architecture:** Pure canon-content change (no `src/` logic): `review` absorbs `eng-review`'s engineering checklist; `eng-review` is deleted from the canon dir + manifest; a routing section is appended to `canon/AGENTS.md` (copied verbatim to all 3 agents). One retrofit integration test that asserted `eng-review` is repointed; canon-validation tests gain routing assertions; the README skills catalog is updated (mandatory).

**Tech Stack:** Markdown canon files + `canon/manifest.yaml`; vitest for canon/retrofit tests; `npx vitest run`, `npx tsc --noEmit`.

---

## File Structure

| File | Change |
|------|--------|
| `canon/skills/review/SKILL.md` | Sharpen description; add an "Engineering-manager checklist" body section (absorbs eng-review) |
| `canon/skills/eng-review/` | **Delete** the directory |
| `canon/manifest.yaml` | Remove the `eng-review` entry |
| `canon/AGENTS.md` | Append a "Skill routing & precedence" section |
| `tests/retrofit/retrofit.integration.test.ts` | Repoint the `eng-review` existence assertion to `review` |
| `tests/canon/real-canon.test.ts` | Assert `eng-review` absent + routing section present |
| `README.md` | Skills catalog: drop eng-review row, fold into review, Roles 8→7, total 25→24 |

**Note:** Historical plan docs under `docs/superpowers/plans/2026-06-27-*` mention `eng-review` — leave them (historical record, like the "Forge" codename). Only the live canon/tests/README change.

---

### Task 1: `review` absorbs the engineering-manager checklist

**Files:**
- Modify: `canon/skills/review/SKILL.md`
- Test: `tests/canon/real-canon.test.ts` (validateCanon must stay green — exercised by the existing "validates with zero errors" test)

- [ ] **Step 1: Sharpen the description.** Replace the frontmatter `description: |` block in `canon/skills/review/SKILL.md` (lines 3-7) with:

```yaml
description: |
  Pre-merge code review — the single canonical review of a change before it lands. Covers BOTH
  diff safety/structure (SQL safety, LLM trust-boundary violations, conditional side effects)
  AND engineering quality (architecture fit, edge cases, test coverage, performance). Use when
  asked to "review this PR", "code review", "pre-landing review", "check my diff", or before
  merging. (For plan-time review use plan-eng-review or plan-ceo-review instead.)
```
Keep the existing `triggers:` list as-is.

- [ ] **Step 2: Add the engineering-manager checklist to the body.** At the END of `canon/skills/review/SKILL.md`, append:

```markdown

## Engineering-manager checklist

Beyond the structural/safety scan above, also review the change as an engineering manager would —
this is the angle the old `eng-review` skill covered, now folded in here so there is one
pre-merge review:

- **Architecture fit:** does the change follow the project's established patterns, or does it
  drift? Flag architectural drift.
- **Edge cases & error paths:** are unhandled inputs, failure modes, and boundary conditions
  covered?
- **Test coverage:** is the changed behavior covered by tests that verify behavior (not just
  mocks)? Missing or weak tests for changed behavior is a blocking issue.
- **Performance:** any obvious regressions (N+1, unbounded growth, needless work in hot paths)?

Output a pass/block verdict with specific, actionable findings. A reviewer never reviews their
own implementation (see `policy/roles.md`).
```

- [ ] **Step 3: Verify canon still validates.**

Run: `npx vitest run tests/canon/`
Expected: PASS — `review`'s frontmatter is intact (name + description), `validateCanon` reports zero errors.

- [ ] **Step 4: Commit**

```bash
git add canon/skills/review/SKILL.md
git commit -m "feat(canon): review absorbs the engineering-manager checklist (one canonical pre-merge review)"
```

---

### Task 2: Remove `eng-review` from the canon + repoint its test

**Files:**
- Delete: `canon/skills/eng-review/` (dir + `SKILL.md`)
- Modify: `canon/manifest.yaml` (remove the entry)
- Modify: `tests/retrofit/retrofit.integration.test.ts` (repoint assertion)
- Test: `tests/canon/real-canon.test.ts` (add an absence assertion)

- [ ] **Step 1: Write the failing assertion.** In `tests/canon/real-canon.test.ts`, add inside `describe('real canon', ...)`:

```typescript
  it('no longer ships the eng-review skill (folded into review)', () => {
    const manifest = loadManifest(join(repoRoot, 'canon', 'manifest.yaml'))
    expect(manifest.skills.some(s => s.id === 'eng-review')).toBe(false)
    expect(manifest.skills.some(s => s.id === 'review')).toBe(true)
  })
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `npx vitest run tests/canon/real-canon.test.ts`
Expected: FAIL — `eng-review` is still in the manifest.

- [ ] **Step 3: Remove the manifest entry.** In `canon/manifest.yaml`, delete the line:
```yaml
  - { id: eng-review, path: skills/eng-review, kind: role }
```

- [ ] **Step 4: Delete the skill directory.**

```bash
git rm -r canon/skills/eng-review
```

- [ ] **Step 5: Repoint the retrofit integration test.** In `tests/retrofit/retrofit.integration.test.ts`, the line (~20) asserts the eng-review skill is written:
```typescript
    expect(existsSync(join(target, '.claude/skills/eng-review/SKILL.md'))).toBe(true)
```
Change it to a skill that still exists:
```typescript
    expect(existsSync(join(target, '.claude/skills/review/SKILL.md'))).toBe(true)
```

- [ ] **Step 6: Run tests.**

Run: `npx vitest run tests/canon/ tests/retrofit/`
Expected: PASS — the new absence assertion passes, `validateCanon` stays zero-error (no manifest entry points at a missing dir), and the repointed integration test passes.

- [ ] **Step 7: Run the full suite + types.**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add canon/manifest.yaml tests/canon/real-canon.test.ts tests/retrofit/retrofit.integration.test.ts
git commit -m "feat(canon): remove eng-review (folded into review); repoint its retrofit test"
```

---

### Task 3: Routing & precedence section in `canon/AGENTS.md`

**Files:**
- Modify: `canon/AGENTS.md`
- Test: `tests/canon/real-canon.test.ts`

- [ ] **Step 1: Write the failing test.** In `tests/canon/real-canon.test.ts`, add (with `readFileSync` imported from `node:fs` — add the import at the top):

```typescript
  it('AGENTS.md carries the skill routing/precedence section', () => {
    const agents = readFileSync(join(repoRoot, 'canon', 'AGENTS.md'), 'utf8')
    expect(agents).toMatch(/Skill routing/i)
    expect(agents).toContain('Pre-merge code review')
    expect(agents).toContain('`review`')
  })
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `npx vitest run tests/canon/real-canon.test.ts`
Expected: FAIL — the routing section does not exist yet.

- [ ] **Step 3: Append the routing section** to `canon/AGENTS.md` (after the existing baseline list):

```markdown

## Skill routing & precedence

When several skills could match the same task, resolve deterministically:

1. **Methodology before role.** Skills that decide *how* to work (`brainstorming`, `writing-plans`,
   `tdd`, `subagent-driven-development`, `systematic-debugging`, …) take precedence and set the
   process. Role skills (`review`, `ship`, `health`, `retro`, …) add a perspective on top.
2. **One canonical entrypoint per concern** — pick the most specific:
   - Plan-time architecture review → `plan-eng-review`
   - Plan-time product / scope review → `plan-ceo-review`
   - **Pre-merge code review → `review`** (the single canonical one)
   - Requesting a review (dispatch a reviewer) → `requesting-code-review`
   - Handling review feedback → `receiving-code-review`
   - Overall order of operations (idea → deploy) → `workflow`
3. **Don't double-run.** These skills declare their own triggers aggressively; when more than one
   matches, the precedence above and the most-specific entrypoint decide. Do not run two skills
   that serve the same concern on the same task.
```

- [ ] **Step 4: Run tests.**

Run: `npx vitest run tests/canon/`
Expected: PASS — routing assertions green, `validateCanon` still zero-error.

- [ ] **Step 5: Commit**

```bash
git add canon/AGENTS.md tests/canon/real-canon.test.ts
git commit -m "feat(canon): emit skill routing/precedence into AGENTS.md (all 3 agents)"
```

---

### Task 4: Update the README skills catalog (mandatory)

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the Roles table + counts.** In `README.md`, in the "What's in the canon" catalog:
  - Remove the `eng-review` row from the **Roles** table.
  - Update the `review` row's description to: `Single canonical pre-merge code review — diff safety + engineering quality (architecture, edge cases, tests, performance)`.
  - Change the Roles group heading count from **8** to **7**.
  - Change the section heading "What's in the canon — 25 skills" to "**24 skills**".

Exact edits:
- Find the line `| \`eng-review\` | Engineering-manager review of a change before merge |` and delete it.
- Find the `review` row `| \`review\` | Pre-landing diff review (SQL safety, trust boundaries, side effects) |` and replace its description cell with `Single canonical pre-merge code review — diff safety + engineering quality (architecture, edge cases, tests, performance)`.
- Find `**Roles** — *gstack-derived, de-gstacked to be harness-agnostic (8)*` → change `(8)` to `(7)`.
- Find `## 🧰 What's in the canon — 25 skills` → change `25` to `24`.

- [ ] **Step 2: Verify counts add up.** Methodology (13) + Roles (7) + Yoke-native (4) = **24**. Confirm the three group counts in the README sum to 24 and the heading says 24.

- [ ] **Step 3: Run the suite** (docs change shouldn't affect tests, but confirm nothing references a removed symbol).

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: drop eng-review from the skills catalog (folded into review), 25→24"
```

---

## Self-Review

**Spec coverage:**
- Routing section in AGENTS.md (precedence + canonical map + arbitration) → Task 3.
- `review` absorbs eng-review's checklist → Task 1.
- `eng-review` removed (dir + manifest) → Task 2.
- Description sharpened (review names its phase; the others — plan-eng-review/plan-ceo-review/
  requesting-/receiving-code-review — are already phase-distinct, so YAGNI: no change) → Task 1.
- Validator stays green + routing/absence assertions → Tasks 2 & 3.
- Retrofit integration test repointed (the one test that hard-codes eng-review) → Task 2.
- README catalog updated (mandatory) → Task 4.

**Placeholder scan:** No TBD/TODO. Every content step shows the exact markdown/yaml. The README
edits are spelled out as find/replace pairs with the exact strings.

**Consistency:** Skill count is 24 everywhere (manifest has 24 entries after removal; README says
24; groups 13+7+4=24). The `review` description and the AGENTS.md routing line agree that `review`
is the single pre-merge code review. No task references `eng-review` as still-present after Task 2.

**Integration note:** Task 2 must run after Task 1 (review must already carry the checklist before
eng-review is deleted, so no coverage is lost between commits). Tasks 3 and 4 are independent and
can run in any order after Task 2.
