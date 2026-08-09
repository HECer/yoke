# PRD Schema

The loop is driven by a continuous PRD backlog. Each story:

```yaml
- id: STORY-1
  title: Short imperative description
  priority: 1            # lower = higher priority
  needs: []              # optional dependency IDs; no unknown IDs, self-links, or cycles
  area: api              # optional collision domain for parallel scheduling
  agent: codex           # optional claude|codex|gemini affinity
  acceptance:
    - id: valid-request-returns-200
      text: The endpoint returns 200 for a valid request.
      verify: [npm run test:valid-request-returns-200]
    - id: invalid-request-returns-400
      text: The endpoint returns 400 for an invalid request.
      verify: [npm run test:invalid-request-returns-400]
  passes: false          # Yoke-owned; true only after all gates pass and the commit lands
```

Each new story has 2–5 acceptance criteria. Every criterion has a stable `id`, observable
behavioral `text`, and one or more executable `verify` commands. Each entry is one approved test
command, contains the normalized criterion ID, and contains no shell control operator. Yoke runs and records each criterion separately in
`.yoke/proof/<story>/evidence.json`; a broad green suite cannot stand in for an untested
criterion. Legacy string criteria remain readable, but `verify.requireCriteria: true` blocks
them.

The binding is deliberately mechanical, not an oracle for product meaning: Yoke can require a
criterion-targeted test command and a separate coverage review, but it cannot prove that arbitrary
test code faithfully models the real world. Critical cross-component behavior therefore also
belongs in a trusted `completion.command` journey suite.

`sourceChange` is an optional Yoke-owned request ID. The change inbox uses it to append new
stories idempotently; authors normally omit it.

Stories without `needs`, `area`, or `agent` retain serial behavior. A story is ready only when
every ID in `needs` passes. The scheduler orders ready work by priority, avoids simultaneously
active areas, and uses `agent` as an affinity hint.

The backlog is continuous, not a release object. A momentary stop condition is every story
having `passes: true`; if configured, `completion.command` must then prove the integrated
system before the loop reports `complete`.
