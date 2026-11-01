---
name: plan-eng-review
description: "Evaluate an implementation plan for architecture, correctness, recovery, compatibility, and measurable efficiency. Use when asked to review a technical plan or architecture before implementation."
---

# Review the engineering decision

Read the proposed plan and the source paths that establish the existing interfaces. Verify assumptions against code and primary documentation when needed. Stay within the requested review unless implementation is authorized.

Prioritize concrete risks:

1. Missing or contradictory acceptance criteria, unsupported assumptions, and simpler existing solutions.
2. State transitions, ownership, concurrency, partial failure, idempotency, and recovery.
3. Input validation, trust boundaries, permissions, secret handling, and untrusted model/tool output.
4. Compatibility, migration, distribution, and rollback.
5. Test seams that prove public behavior and meaningful failure cases.
6. Measured hot paths, I/O, model calls, context size, and operating cost.

Do not equate file count, abstraction count, or test count with quality. Recommend local simplification where it removes a real responsibility or failure mode. Treat language rewrites as investments requiring a measured bottleneck, retained behavior, and a bounded migration path.

For each material issue, give the source or scenario, impact, recommended change, and acceptance evidence. Separate blockers, improvements, and unknowns. A small table is usually enough; use a state or data-flow diagram when it clarifies ownership or failure behavior.

Reuse earlier decisions and current evidence. Do not require a question after every section or an independent model for every option. Ask only for an unresolved choice that materially changes scope, cost, compatibility, or risk. Continue authorized work after the review findings are addressed.
