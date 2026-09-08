# Dashboard Overhaul: Feature Contract

Status: approved implementation scope
Date: 2026-09-08

This document turns the dashboard request into executable product definitions.
Each feature below has a bounded behavior, source of truth, safety rule, and
acceptance proof. It is an implementation contract, not a list of future ideas.

## North star

Yoke Dashboard is a local-first operations console for autonomous work. A user
can move from workspace-level ranking to one run, understand what happened,
intervene safely at a loop boundary, and leave a durable note or change request
without interrupting the worker or inventing a second execution path.

## Feature definitions

### F1 — Unified workspace control room

The overview loads all registered projects into one ranked workspace. Each row
shows project identity, current state, freshness, objective, last activity,
latest run, token totals, cost coverage, accepted/failed outcome, and the next
available safe action. A project can be sorted by attention, active state, last
activity, token usage, cost, acceptance, or name. Search and status filters are
composable and persist in navigation state.

Source: registry, goal/loop snapshots, events, history measurements, and checks.

Rule: missing projects and partial telemetry remain visible; an unknown metric
never becomes zero.

### F2 — Historical telemetry and rankings

The dashboard exposes a selectable date range and bucket (day, week, month) for
workspace and project views. It aggregates input, output, cached, cache-write,
reasoning, total tokens, measured/unknown calls, attempts, accepted runs,
repairs, escalations, elapsed time, and reported cost. It ranks projects,
agents, providers, models, roles, phases, and runs, with measurement coverage
shown alongside every aggregate.

Source: durable history archives plus bounded live events.

Rule: aggregation is deterministic and bounded; corrupt archives are reported
as coverage gaps, not silently discarded or counted as zero.

### F3 — Run explorer and event timeline

A project detail view provides a run list and a chronological timeline. Users can
expand an event to inspect run/attempt/story/phase identifiers, agent metadata,
token fields, outcome, and source timestamp. The view supports the same date
range and an explicit “live” scope.

Source: event stream and history records, joined by run ID where available.

Rule: show UTC and local time clearly; bound event and archive reads; stale live
data is labeled unconfirmed.

### F4 — Safe live controls

The selected project has pause and resume controls. Pause uses Yoke’s existing
`.yoke/loop.pause` and `.yoke/goal.pause` safe-boundary mechanisms. Resume calls
the existing loop/goal runner with one guarded invocation and respects the loop
lock; it never starts a duplicate worker. The UI reports requested, running,
paused, blocked, and failed-to-start states separately.

Rule: all writes require loopback same-origin plus the dashboard session token.
No action accepts a filesystem path or shell string from the browser.

### F5 — Operator notes and queued changes

While work runs, a user can append a short operator note or queue a typed change
request. Notes are append-only and displayed in the timeline. Change requests
reuse Yoke’s existing append-only change inbox and are processed at its normal
safe planning boundary. The UI shows pending/applied state and the request ID.

Rule: notes and changes are never executed as shell commands. Input is bounded,
validated, escaped on render, and retained as project-local operational history.

### F6 — Theme, density, and responsive access

Dark and light themes use the design tokens in `DESIGN.md`; first load respects
system preference, then remembers the user’s choice. The shell works at desktop,
tablet, and narrow widths. Tables remain scannable through column priorities,
horizontal overflow where necessary, and accessible labels.

Rule: contrast, focus, reduced motion, keyboard navigation, and non-color status
signals are tested; visual polish cannot hide loading, empty, error, or stale
states.

### F7 — Honest operational states

Every live panel shows last successful sync, source scope, and data coverage.
Active-but-stale work becomes “unconfirmed”; unavailable costs/tokens are
explicit. Corrupt project files produce an actionable per-project error without
breaking the workspace view.

Rule: the dashboard never claims process health merely because a status file says
running; freshness and source errors are part of the displayed state.

### F8 — Stable local API contract

The server provides bounded, same-origin JSON for workspace overview, project
snapshot, project history/events, and typed controls. Responses are safe to
render as untrusted project text. Query ranges, limits, sort keys, and action
payloads are schema-validated.

Rule: preserve existing routes where possible, keep the server loopback-only,
and add tests for authorization, path safety, malformed input, concurrency, and
partial history.

## Delivery slices

The Yoke loop executes these slices in dependency order:

1. Contract, design tokens, shared telemetry/control types, and API helpers.
2. Historical aggregation, run/event projections, and workspace endpoints.
3. Typed operator controls, append-only notes, and guarded resume.
4. New shell, theme system, workspace ranking, and responsive state components.
5. Project live view, controls, timeline, notes, and queued changes.
6. Analytics/history explorer with all rankings and coverage explanations.
7. Accessibility, loading/error/empty/stale states, performance bounds, and
   focused regression tests.
8. README/docs synchronization and final integrated verification.

## Non-goals for this release

- Remote multi-user access, accounts, or cloud storage.
- Arbitrary shell execution from the browser.
- Replacing the loop, goal runner, provider routing, or lock protocol.
- Fabricating historical metrics that were not recorded.
- A second real-time transport dependency; polling with freshness indicators is
  sufficient for the local-first release.

## Acceptance checklist

- A workspace user can rank projects by attention, activity, tokens, cost, and
  name and open a project without losing filters.
- A project user can inspect a bounded historical run/event view and identify
  agent/provider/model/role/phase/time when recorded.
- A project user can pause at the existing safe boundary, resume without a
  duplicate loop, add a note, and queue a change request from the UI.
- Dark/light themes, keyboard focus, responsive layout, and reduced motion work.
- Partial, unknown, stale, corrupt, and missing data are explicit and isolated.
- Existing dashboard security and tests remain green; new behavior has focused
  tests plus build/lint coverage.
