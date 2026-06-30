---
name: visual-verification
description: Use for any UI/web project — make the verify gate cover more than unit tests by composing a pipeline (types → unit → design-scan → flow-smoke) and driving a Playwright flow-smoke (render + no console errors + screenshot); capture video only on failure. Catches the unwired-page / runtime-crash / AI-slop bugs unit tests miss.
---

# Visual verification

Unit tests don't see a blank page, an unwired route, a runtime console error, or AI-slop design.
Make the loop's gate catch them by widening `verify`, since the loop trusts verify as truth.

## 1. Compose the verify pipeline

Set `verify.command` (in `.yoke/config.yaml`) to chain, fail-fast:

```
<typecheck> && <unit tests> && yoke design-scan . && <flow-smoke>
```
e.g. `tsc --noEmit && vitest run && yoke design-scan . && npm run smoke`. Any red step blocks the story.

## 2. Flow-smoke with the wired Playwright MCP

For the key user flows (home, signup/login, the primary action, checkout), against the running
dev server:
- load the route, assert it renders the expected landmark, and assert the **console has no errors**;
- take a screenshot of each for the record.

This is what catches "the page is wired wrong / it crashes on load" — the class of bug unit tests pass straight through.

## 3. Video only when necessary

Recording + analysing video is token-heavy. Capture a video of a flow **only when a flow-smoke
fails** (or when explicitly debugging a UX problem), then analyse that clip. Never record every run.

## Rule

Green pipeline = types + units + no design-slop over budget + key flows render without console
errors. Only then is the story actually done.
