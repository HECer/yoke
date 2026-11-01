---
name: verification-before-completion
description: "Verify a claimed outcome with current evidence before reporting success. Use at acceptance, integration, or release boundaries; scale checks to the change and explicit project gates."
---

# Establish evidence for the claim

Identify the claim and the command or observation that could falsify it. Run the required check against the current candidate and inspect the exit result and relevant output. Keep full evidence available when a compact summary omits details.

Distinguish process success, valid structured output, behavioral acceptance, integration success, and publication. One does not automatically establish the next. Unknown, unavailable, timed-out, or unsupported checks are not passing checks. An approval with a blocking finding is contradictory.

Reuse cached evidence only when its declared inputs, configuration, environment, and candidate identity still match. Never reuse acceptance/integration evidence across changed source or substitute a model's assertion for an executable gate.

Use focused checks during iteration and required broader checks at the boundary. Do not run unrelated suites repeatedly or add tests that merely mirror a low-impact edit. Resolve a concrete remaining risk before expanding verification.

Report exact meaningful results and their limits. If verification is incomplete, preserve the work, explain the gap, and continue any unaffected authorized work.
