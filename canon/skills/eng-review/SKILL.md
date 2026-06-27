---
name: eng-review
description: Use before merging a change — engineering-manager review of architecture, edge cases, test coverage, and performance.
---

# Engineering Review

Review a change for: architecture fit, data flow, edge cases, test coverage, and performance. Be opinionated. Block on:

- Missing or weak tests for the changed behavior.
- Unhandled error paths or edge cases.
- Architectural drift from the project's established patterns.

Output: a pass/block verdict with specific, actionable findings. A reviewer never reviews their own implementation (see `policy/roles.md`).
