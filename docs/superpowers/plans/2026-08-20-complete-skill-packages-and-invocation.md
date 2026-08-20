# Complete Skill Packages and Invocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Install every Canon skill as a complete, safe resource package and preserve explicit automatic or manual invocation intent across Claude, Codex, and Gemini.

**Architecture:** Extend the parsed Canon manifest with a defaulted invocation policy, enumerate package files once behind a fail-closed boundary, and make every provider planner consume the same normalized package model. Extend Retrofit actions only enough to preserve byte content and executable intent; provider-specific policy remains generated output, not Canon source.

**Tech Stack:** TypeScript, Zod, YAML, Vitest, Node filesystem APIs.

---

## Task 1: Add invocation policy to the manifest contract

**Files:** `src/canon/manifest.ts`, `tests/canon/manifest.test.ts`, `tests/canon/real-canon.test.ts`, `canon/manifest.yaml`

1. Add failing tests proving omitted `invocation` parses as `auto`, `manual` parses, and unknown values fail.
2. Add `InvocationSchema = z.enum(['auto', 'manual'])` and default `invocation` to `auto` on each skill entry.
3. Add explicit `invocation` values to every real Canon skill and assert the real manifest has no implicit entries.
4. Run `rtk npm exec -- vitest run tests/canon/manifest.test.ts tests/canon/real-canon.test.ts`.

## Task 2: Enumerate and validate complete skill packages

**Files:** `src/canon/skill-package.ts`, `src/canon/validate.ts`, `tests/canon/skill-package.test.ts`, `tests/canon/validate.test.ts`

1. Write failing tests for stable relative-path ordering, nested Markdown and binary resources, executable metadata, symlink rejection, path escape rejection, unsupported node types, duplicate normalized targets, and missing relative Markdown references.
2. Implement `enumerateSkillPackage(canonDir, skill)` returning immutable records with `relativePath`, `content: Buffer`, and `executable`.
3. Normalize separators to `/`, resolve every candidate beneath the skill root, use `lstat` to reject links and special files, and never follow a path outside the root.
4. Extend Canon validation to enumerate each package and validate local relative Markdown links without fetching HTTP links or validating anchors.
5. Run `rtk npm exec -- vitest run tests/canon/skill-package.test.ts tests/canon/validate.test.ts` and `rtk npm run yoke -- validate canon`.

## Task 3: Let Retrofit actions preserve package bytes and executable intent

**Files:** `src/retrofit/plan.ts`, `src/retrofit/apply.ts`, `tests/retrofit/apply.test.ts`

1. Add failing tests for a binary action, unchanged binary content, and executable-mode preservation where the platform supports it.
2. Change write actions to accept `string | Uint8Array` and optional `executable`; retain string-only JSON merge and carry-preserved behavior with explicit guards.
3. Compare and write buffers without UTF-8 conversion. Apply executable bits on non-Windows after the atomic content write.
4. Run `rtk npm exec -- vitest run tests/retrofit/apply.test.ts`.

## Task 4: Generate provider-specific skill outputs

**Files:** `src/retrofit/skill-actions.ts`, `src/retrofit/planners/claude.ts`, `src/retrofit/planners/codex.ts`, `src/retrofit/planners/gemini.ts`, `tests/retrofit/planners/claude.test.ts`, `tests/retrofit/planners/codex.test.ts`, `tests/retrofit/planners/gemini.test.ts`

1. Add fixtures containing nested Markdown and a binary resource, plus one manual skill.
2. Add failing Claude tests for complete package copying and `disable-model-invocation: true` only on generated manual `SKILL.md` frontmatter.
3. Add failing Codex tests for complete copying and generated or merged `agents/openai.yaml` with `policy.allow_implicit_invocation` matching the manifest.
4. Add failing Gemini tests for copied resources, unchanged command generation, manual command-only behavior, and a compact auto-skill index that excludes manual skills.
5. Implement shared action generation from the package enumerator. Ensure generated policy files cannot silently conflict with a Canon-provided file.
6. Run all three planner test files.

## Task 5: Prove backward compatibility end to end

**Files:** `tests/retrofit/integration.test.ts`, `tests/canon/real-canon.test.ts`

1. Add an integration test that an existing one-file skill installs byte-for-byte as before.
2. Add an integration test that one resource-bearing skill installs its referenced resource for all three agents.
3. Run `rtk npm exec -- vitest run tests/canon tests/retrofit` and `rtk npm run lint`.

