---
name: tdd
description: "Use a failing behavioral test to guide a feature or defect fix when an executable test can meaningfully establish the requirement. Follow explicit project test-first rules; do not impose artificial tests on prose or trivial configuration edits."
---

# Develop against observable behavior

Choose a small behavior with a meaningful public contract. Write or reproduce a test that fails for the relevant missing behavior, then run it and verify the failure is diagnostic rather than a fixture, syntax, or environment error.

Implement enough to satisfy the behavior. Run the focused test, then simplify the implementation while it remains green. Add boundary and failure cases according to risk: invalid inputs, ownership, resource cleanup, concurrency, partial writes, and compatibility matter more than mirroring private branches.

Prefer tests through the public interface. Mock external boundaries when necessary, not the code whose behavior the test should establish. Verify error paths and emitted artifacts where they are part of acceptance. Keep assertions specific enough to catch a plausible wrong implementation.

Use proportionate verification for nonbehavioral edits: type/schema checks for configuration, rendered or command checks for documentation, and existing tests for local refactors. Do not delete working code to reenact a test-first sequence. If an existing project explicitly requires test-first development, follow that policy.

Run required integration and release checks at their boundaries; focused tests are not a substitute. Consult [testing-anti-patterns.md](testing-anti-patterns.md) when mocks, test-only production APIs, or brittle implementation assertions obscure the behavior. Report unavailable checks honestly.
