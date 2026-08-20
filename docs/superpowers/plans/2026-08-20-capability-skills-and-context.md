# Capability Skills and Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Add the prose, domain, codebase-design, merge-resolution, and agent-writing capabilities identified in the source review, with durable terminology context and clear attribution.

**Architecture:** Keep capabilities as independent Canon packages selected through the manifest. Use resource files for evaluation material, keep `.yoke/context` as the durable project source of truth, and connect prose review to documentation workflows without making style a release gate.

**Tech Stack:** Markdown skill packages, TypeScript context loader, YAML manifest, Vitest, provenance audit tools.

---

## Task 1: Import and adapt `no-ai-slop`

**Files:** `canon/skills/no-ai-slop/SKILL.md`, `canon/skills/no-ai-slop/eval.md`, `canon/ATTRIBUTION.md`, `canon/manifest.yaml`, `tests/canon/real-canon.test.ts`

1. Run a read-only provenance audit on the upstream package and record unknown signals as unknown.
2. Add failing real-Canon assertions for the package, its `eval.md` reference, auto invocation, and Peter Yang/MIT attribution.
3. Import the upstream workflow and evaluation checklist. Adapt only the trigger wording, Yoke paths, and the precise-domain-term exception; preserve Edit and Detect modes and prohibit authorship guesses.
4. Run the package tests and a second read-only provenance audit on the local package.

## Task 2: Add the four complementary capabilities

**Files:** `canon/skills/domain-modeling/SKILL.md`, `canon/skills/codebase-design/SKILL.md`, `canon/skills/resolving-merge-conflicts/SKILL.md`, `canon/skills/writing-for-agents/SKILL.md`, `canon/ATTRIBUTION.md`, `canon/manifest.yaml`, `tests/canon/real-canon.test.ts`

1. Add failing assertions for all four skill ids, frontmatter, auto invocation, and source attribution where material is adapted from Matt Pocock's repository.
2. Write `domain-modeling` around terminology discovery, scenario checks, code comparison, glossary updates, and the existing ADR threshold.
3. Write `codebase-design` around deep modules, small interfaces, real seams, public-interface tests, and local change.
4. Write `resolving-merge-conflicts` around current-operation discovery, commit/spec evidence, preservation of both compatible intents, scoped checks, and no implicit abort.
5. Write `writing-for-agents` around observable outcomes, concrete paths and commands, bounded context, explicit triggers, and deduplicated durable instructions.
6. Validate Canon and run the real-Canon tests.

## Task 3: Add glossary-aware project context

**Files:** `canon/context/GLOSSARY.md`, `src/retrofit/context-actions.ts`, `src/context/context.ts`, `src/context/command.ts`, `tests/retrofit/context-actions.test.ts`, `tests/context/context.test.ts`, `tests/context/command.test.ts`

1. Add failing tests that Retrofit introduces `GLOSSARY.md` with `ifAbsent`, existing context is unchanged, and `CONTEXT-MAP.md` is loaded only when present.
2. Add a concise glossary template for canonical terms, aliases, rejected terms, and concrete examples.
3. Extend context loading and formatted prompt context with bounded glossary content and optional bounded context-map content.
4. Extend context status output so required glossary state and optional context-map state are distinguishable.
5. Run the context and context-action tests.

## Task 4: Connect prose quality to documentation workflows

**Files:** `canon/skills/document-release/SKILL.md`, `canon/roles/docs.yaml`, `CONTRIBUTING.md`, `tests/canon/real-canon.test.ts`

1. Add failing assertions that documentation release guidance invokes `no-ai-slop` evaluation without turning it into a mechanical pass/fail gate.
2. Update the skill and docs role to request minimal voice-preserving edits and explicit reporting of observed patterns.
3. Use the new skill in Detect mode on changed prose, then Edit mode only where a listed pattern is actually present.
4. Run Canon validation and provenance-audit the changed documentation set.

