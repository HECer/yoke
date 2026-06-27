---
name: tdd
description: Use when writing any production code — enforces RED-GREEN-REFACTOR, no production code without a failing test first.
---

# Test-Driven Development

The Iron Law: **No production code without a failing test first.**

1. **RED** — write the smallest failing test for the next behavior. Run it; confirm it fails for the right reason.
2. **GREEN** — write the minimal code to make it pass. Run it; confirm it passes.
3. **REFACTOR** — clean up without changing behavior. Tests stay green.
4. **COMMIT** — one behavior per commit.

Never write multiple tests ahead of implementation. Never skip the failing-run step.
