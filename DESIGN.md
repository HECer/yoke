# Yoke Dashboard Design System

Status: implementation source of truth for the dashboard overhaul
Last reviewed: 2026-09-08

## Product feeling

The dashboard is an operations console for autonomous engineering work. It should
answer three questions immediately:

1. What is running right now?
2. What needs attention, and why?
3. What can I safely do next?

The memorable interaction is a calm, glanceable control room: status is obvious,
history is trustworthy, and every intervention explains its scope and safety.

## Visual direction

Use an industrial editorial control-room language: dense but breathable, quiet
surfaces, thin structural rules, compact data, and a single warm action accent.
The interface is dark-first but has an equally intentional light theme. Avoid
gradients, decorative illustrations, oversized hero copy, and card grids that
hide the actual data.

## Tokens

### Dark theme

- Canvas: `#0b0f12`
- Surface: `#11171c`
- Raised surface: `#172027`
- Rule: `#2a3740`
- Text: `#e9eff1`
- Muted text: `#91a0a8`
- Action amber: `#ffb454`
- Signal cyan: `#69d6d0`
- Positive: `#72d39a`
- Warning: `#f2c66d`
- Danger: `#ff8585`

### Light theme

- Canvas: `#f1f4f3`
- Surface: `#ffffff`
- Raised surface: `#f7f9f8`
- Rule: `#d4dddc`
- Text: `#17242a`
- Muted text: `#61727a`
- Action amber: `#a85f00`
- Signal cyan: `#087d79`
- Positive: `#197345`
- Warning: `#875b00`
- Danger: `#ae3434`

All colors must be exposed through CSS custom properties. Status colors must not
be the only signal: pair them with text, icons, or labels.

## Typography

- UI and reading text: `Instrument Sans`, falling back to a local sans-serif.
- Numeric telemetry and identifiers: `JetBrains Mono`, falling back to a
  monospace font.
- Headings are sentence case, compact, and never used as decorative display art.
- Use tabular numerals for token, cost, duration, and count columns.

## Layout

- Persistent left rail: product mark, overview, history, settings, and a compact
  ranked project list.
- Top command bar: current scope, time range, search, sync age, theme control,
  and the primary safe action for the selected project.
- Main canvas: one prominent attention/live region followed by dense telemetry.
- Detail pages use a two-column layout on wide screens and a single ordered flow
  below 980px.
- Tables are preferred for comparable data; cards are reserved for KPIs and
  actions. Use a 12-column grid with a 24px outer gutter and 16px gaps.

## Components

- `StatusRail`: state, freshness, and attention reason in one compact unit.
- `MetricStrip`: four to six KPIs with value, unit, period, and measurement
  coverage.
- `ProjectRow`: rank, project identity, state, last activity, token burn, and
  next action.
- `Timeline`: chronological events with UTC/local time toggle, actor metadata,
  phase, and expandable payload details.
- `ControlBar`: pause, resume, add note, queue change; destructive or ambiguous
  actions require confirmation and explain safe-boundary behavior.
- `FilterBar`: scope, date range, bucket, status, agent/provider/model, and sort.
- `EmptyState` and `ErrorState`: state what is known, what is unavailable, and
  how to recover.

## Interaction and motion

- Poll live state every five seconds while a project is active; show the last
  successful sync and mark stale data explicitly.
- Animate only state changes and progress, with 150–220ms transitions.
- Respect `prefers-reduced-motion`.
- Keyboard focus is visible, logical, and never indicated by color alone.
- Theme and table sort persist locally; navigation is shareable through the URL
  hash without putting secrets into it.

## Content rules

- Say `Unknown` when usage is not measured; never display missing usage as zero.
- Show agent, provider, model, variant, role, project, phase, run, and time when
  the source has them. Label absent dimensions as `Not reported`.
- Every action states whether it is immediate or queued for the next safe loop
  boundary.
- Do not expose arbitrary command execution. Operator input is a note or a typed
  change request processed by the existing Yoke inbox.

## Quality bar

The dashboard is successful when a user can identify the riskiest active project
within five seconds, explain its recent token/cost activity within one minute,
and pause or annotate it without leaving the dashboard. It must remain useful
when a project is missing, stale, corrupt, partially measured, or offline.
