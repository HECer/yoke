# Dashboard evolution

The local dashboard is an actionable control room for registered Yoke projects. It reads the same saved project, loop, goal, acceptance, and measurement data as the CLI. Project-controlled text is rendered through `textContent`, and the server remains bound to the loopback interface with same-origin session authorization for typed controls. The full feature contract is in [DASHBOARD-OVERHAUL.md](DASHBOARD-OVERHAUL.md).

## Overview

Project status is derived from both the saved goal and the latest loop report. A blocked or running loop is not hidden by a completed goal. When goal and loop states differ, the card displays both. Blocked, failed, paused, unavailable, and stale active reports need attention; those projects are ordered before active projects, followed by the remaining projects.

Cards also show the reported current task and saved blocker reason when available, so the overview explains why a project needs attention before opening it.

An active loop report more than 20 minutes old is labeled **unconfirmed**. This means Yoke has an old active report, not evidence that the process is still live. The overview can be searched by project name, canonical path, or goal objective and filtered to All, Active, or Needs attention. A no-match state explains the result and provides a clear action that resets both search and filter.

## Workspace control room

The overview ranks projects by attention, last activity, recorded tokens, reported cost, accepted work, or name. Search and status filters compose with the ranking, and the validated URL hash preserves the selected screen and time scope. A project row opens the live view without losing the operator’s navigation context.

The project live view shows goal and loop state independently, freshness, current worker metadata, objective progress, last successful sync, pause/resume actions at the existing safe boundary, an operator-note form, a queued-change form, and a bounded expandable event timeline. Notes are append-only events. Changes become pending inbox requests and are consumed by the existing planning boundary; the browser cannot run arbitrary commands.

## Measurement coverage

The dashboard labels recorded, partial, unknown, stale, corrupt, unavailable, and empty data separately. **Measurement coverage** is always shown alongside analytics: missing provider usage or price is not reconstructed, and a missing bucket means no recorded activity rather than a measured zero. A stale active report is shown as unconfirmed, not healthy.

## Durable navigation

The URL hash stores the current screen, project, project tab, period, UTC grouping, ranking/filter state, and complete custom date range. Supported screens are the overview, workspace analytics, and project detail. Supported project tabs are Now, Usage & time, Results, and History; periods are 1, 7, 30, 90, or 365 days; groupings are day, week, or month. Custom dates must be real ISO calendar dates in chronological order and cover at most 366 inclusive days.

Invalid hash state returns to the overview with the 30-day/day defaults. Browser back and forward, a page reload, and Refresh restore the validated state. Refresh reloads data without resetting the selected view or controls. Starting any navigation aborts earlier fetches and changes a request generation, so an older response cannot replace the current screen.

The workspace comparison schedules at most three project analytics requests at once. If navigation changes, in-flight fetches are aborted and no additional obsolete project requests are scheduled. All projects and individual project links remain available in the navigation while viewing the comparison.

## Analytics and history

Workspace and project analytics expose time-bucketed recorded tokens, calls, duration, outcomes, cost state, and rankings by agent, provider, model, variant, role, phase, project, and run. The history explorer exposes at most 100 events in chronological order and identifies run, story, phase, agent/provider/model metadata, local time, and UTC time when recorded. Unknown values remain unknown; no chart or comparison converts missing measurements to zero.

## Usage comparisons

Usage & time compares the selected period with the immediately preceding period of exactly the same duration. A single time boundary is captured before either analytics request is made. The comparison covers recorded input plus output tokens, recorded acceptance events, and reported cost.

When the preceding value is zero, the dashboard describes no change or new recorded activity instead of calculating an infinite percentage. A cost percentage is shown only when both periods have fully measured cost. Otherwise the dashboard says the percentage is unavailable. Current and previous missing-usage coverage is displayed from calls with unknown usage and unmeasured attempts. Recorded portions remain recorded portions; missing tokens or charges are not estimated as zero.

Charts and their tables include periods that contain recorded events. Empty UTC calendar buckets are omitted and the chart explains that a gap means no recorded activity, not a measured zero. Detailed provider/model/role, model timeline, task, and phase tables remain below the comparison.

## Design findings and limitations

Goal state and loop state describe different durable facts and need independent presentation. Freshness is also separate from state: a saved `running` value can become unconfirmed without being rewritten. Navigation state belongs in the URL because the dashboard has several independently useful views and time controls. Analytics fan-out needs cancellation as well as a concurrency bound because registered workspaces may contain many projects.

The dashboard combines local saved evidence with process-identity checks for supervised providers (see [Windows runner validation](WINDOWS-RUNNER-VALIDATION.md)). Unverified process identity remains unknown. It does not reconstruct activity that predates retained measurements, estimate missing provider usage or prices, or turn requested model names into proof of models used. Parallel call durations can overlap, so summed call time is consumption intensity rather than generation speed. The 20-minute freshness threshold is a presentation rule, not a process-health guarantee. No provider performance benchmark is implied by these views.
