---
name: requesting-code-review
description: "Request independent review of a completed change or a specific high-risk boundary. Use the host reviewer or Yoke review gate; avoid duplicate reviews of unchanged work."
---

# Request an evidence-based review

Use the project's required review policy. For ordinary changes, request one review of the integrated outcome; add a specialist only for a specific security, concurrency, migration, or other material risk. Small tasks do not automatically need separate specification and code-quality reviewers.

Give the reviewer the approved objective, relevant acceptance criteria, base/candidate identities, permitted read scope, exact diff, and current check results. Avoid the implementer's conclusions as proof. Use [code-reviewer.md](code-reviewer.md) for the handoff when helpful.

Inside a Yoke worker, hand evidence to the controller instead of launching nested agents. Without an independent mechanism, report that review is unavailable; do not call a self-check independent.

Require concrete findings with location, failure scenario, impact, and validation evidence. Separate blockers from suggestions. Reject an approval that also contains blocking findings. Fix confirmed defects, verify the change, and request follow-up only for affected findings or invalidated evidence. Do not reopen unchanged scope just to obtain another approval.
