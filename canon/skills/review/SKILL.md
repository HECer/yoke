---
name: review
description: "Review the actual change for acceptance, correctness, security, and regressions. Use for a PR or diff review and required pre-merge gates; findings must be evidence-based and actionable."
---

# Review the integrated change

Identify the approved objective, base/candidate identities, write scope, and required acceptance checks. Inspect the actual diff and relevant surrounding interfaces, not just the implementation summary. Preserve unrelated user work and stay read-only unless fixes are authorized.

Prioritize defects that affect behavior: missing requirements, incorrect state transitions, data loss, races, leaks, security boundaries, invalid external/model output, compatibility, and unsupported success claims. Inspect changed error paths and tests. Check that validation evidence applies to the current candidate and that protected acceptance was not weakened.

Follow a concrete failure scenario through the code. For security-sensitive input, persistence, cancellation, and concurrency, try an appropriate counterexample. A separate adversarial model is optional; the obligation is to test the boundary, not multiply reviewers. Do not block a change on taste, arbitrary test counts, or speculative abstractions.

Return findings with severity, exact location, trigger, impact, and suggested verification. Distinguish blockers from improvements and state coverage limits. An approval cannot coexist with a blocking finding. When the host requires a structured verdict, use its exact schema and include every required field.

Resolve confirmed blockers when authorized, then recheck affected behavior. Reuse unchanged, still-valid evidence. Escalate only unresolved product or risk decisions; do not ask the user to approve each obvious repair or force an extra reviewer after every small change.

Finish with an evidence-backed disposition: accepted against the stated scope, changes required, or validation incomplete. A green test summary alone does not prove release readiness.
