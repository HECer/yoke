---
name: systematic-debugging
description: "Investigate a reproducible failure or unexpected behavior by testing causes before changing code. Use for defects with uncertain cause; keep already diagnosed fixes proportionate."
---

# Find and verify the cause

Capture the smallest failing command or input, expected behavior, actual result, environment, and relevant logs. Distinguish a code defect from missing credentials, unavailable executables, broken fixtures, or unsupported runtime behavior. Preserve complete evidence outside model context and inspect bounded relevant excerpts.

Trace the failing path through its real inputs and state transitions. Read nearby code and compare a working case. State one testable hypothesis; run a discriminating check before making unrelated changes. Inspect ownership and partial-failure recovery for concurrency or persistence bugs.

Fix the cause at its responsible boundary. Add a regression test when it can demonstrate the failure and protect the behavior; a document typo or static configuration edit does not need an artificial failing unit test. Never weaken protected tests or acceptance to make the result green.

Run the reproduction and affected checks. Broaden validation only for a concrete remaining risk or a required integration gate. If a repair fails, record what the evidence ruled out before trying again. Stop an unproductive sequence at its configured attempt/time budget; do not disguise retries as new tasks.

Report the cause, behavior changed, checks, and limits. Use [root-cause-tracing.md](root-cause-tracing.md) for a failure far from its source, [condition-based-waiting.md](condition-based-waiting.md) for timing-dependent tests, and [defense-in-depth.md](defense-in-depth.md) when several trust boundaries need independent validation. Load only the relevant reference.
