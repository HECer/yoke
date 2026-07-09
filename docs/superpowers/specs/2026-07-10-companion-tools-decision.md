# Companion tools — integration decision (2026-07-10)

Evaluated four ecosystem projects for integration into Yoke. Criteria: fit with the
curated-canon promise (small, cross-agent, token-lean), maintenance cost of a vendored
copy vs. a documented boundary, and overlap with existing canon skills.

## Decisions

| Project | Decision | Form |
|---|---|---|
| [claude-mem](https://github.com/thedotmack/claude-mem) (Apache-2.0) | **Integrate as optional companion** | `canon/tools/claude-mem.md` — documented wiring, external installer |
| [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) (MIT) | **Integrate as optional companion** | `canon/tools/ui-ux-pro-max.md` — documented pairing, external installer |
| [ux-ui-mastery](https://github.com/phazurlabs/ux-ui-mastery) (MIT) | **Rejected** | — |
| [claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | **Not an integration target — a distribution channel** | Yoke itself packaged as a plugin; see the plugin packaging work |

## Rationale

- **claude-mem**: mature, multi-agent, solves a real gap (interactive cross-session memory).
  But it is a runtime service (worker + vector DB) — the opposite of Yoke's zero-runtime
  philosophy — so it is wired like rtk/Serena/Playwright MCP: externally installed, boundary
  documented. Hard rule recorded in the tool doc: **no automatic memory injection inside loop
  runs** — the loop's memory is the versioned context layer + PRD, by design (reproducibility,
  reviewability, git history).
- **ui-ux-pro-max**: complementary, not overlapping — it improves design *generation*; Yoke's
  `unslop-ui`/`design-scan`/`visual-verification` do design *verification*. It ships its own
  cross-agent installer and fast update cadence; a vendored copy would go stale. Documented
  as a pairing, not vendored.
- **ux-ui-mastery**: rejected. ~310k words across 19 skills would break the curated-canon and
  token-efficiency promises, it is Claude-only (no cross-agent story), largely redundant with
  `unslop-ui` + ui-ux-pro-max, and low-traction/low-activity at evaluation time. Users who want
  it can install it as a Claude plugin alongside Yoke with zero support from us. Revisit only
  if a specific gap (e.g. an accessibility-audit skill) justifies porting a *single* skill with
  attribution, as done for superpowers/gstack.
