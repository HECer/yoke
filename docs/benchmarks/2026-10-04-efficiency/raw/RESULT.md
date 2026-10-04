# NEXUS — benchmark result

**Implementation complete.** React/TypeScript/Vite application runs at http://127.0.0.1:6317. Start independently with `npm ci` and `npm run dev`.

Completed: 12 typed systems; interactive animated SVG topology with selection, pan/zoom/reset/focus; deterministic one-second telemetry and pause/resume; detailed inspector and operator commands; injected/acknowledged incidents; timestamped events and KPIs; searchable keyboard command palette; Fleet search/filter/sort/context selection; responsive desktop/mobile layout. Other navigation modules deliberately identify their unavailable benchmark state.

## Validation

- Final root `npm run verify` passed: TypeScript, 25 unit/component tests, six Chromium browser journeys, production build. No lint configuration exists.
- Browser journeys exercise simulation, incidents, inspector, topology, palette keyboard/focus behavior, Fleet, navigation and responsive operations; zero console/page errors asserted.
- Independent root-server inspection verified listener cwd and served source signature: 1440×900 document fits without scrolling; event panel bottom 884px. Mobile 390×844 has no horizontal overflow; vertical scrolling exposes inspector/events.
- Five required exact-viewport screenshots in `screenshots/`: overview, selected-machine, incident, Fleet and mobile. Additional `running-overview.png` shows live telemetry and a timestamped event. Final screenshots were visually inspected.
- Yoke 1.22.0: 7/7 stories pass, eight implementation attempts (STORY-5 retried following an observer-caused HEAD change), isolated worktrees, automatic scheduling/decisions, peak two implementation workers. Continuous exploration was never enabled.
- Final integrated root Yoke flow-smoke passed 1/1 on committed source `edd9292`, with matching before/after fingerprints. Report: `measurements/final-yoke-smoke.json` (this artifact packaging follows the measurement cutoff).
- Yoke acceptance gates passed; final story design-scan score 0 against budget 4; story flow-smoke 1/1 passed. Two later observer smoke attempts ran 1/1 successful flows but correctly rejected source evidence while observer files changed; these are recorded separately from product checks.

## Environment and limitations

Codex CLI 0.160.0; worker model gpt-6.1-sol / medium; RTK 0.51.0 native Codex integration and explicit commands verified. Code Intelligence configured **ACTIVE** and MCP facade functional, but graft/graphify/serena semantic backends unavailable: this requested capability could not deliver semantic analysis. No known failing product acceptance criteria remain. Simulation is local and deterministic; there is no backend.

Detailed measured times, provider token usage by story/role, retries, RTK estimates, observer overhead and improvement findings: [DEVELOPMENT_ANALYSIS.md](DEVELOPMENT_ANALYSIS.md). Machine-readable tables and metadata: [measurements/](measurements/). Measurement cutoff is recorded there; later report packaging and the final reply are excluded. Monetary cost is unknown. No hidden reasoning content is included.
