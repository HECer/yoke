---
name: subagent-driven-development
description: "Coordinate independent implementation work when the host supports delegation and the task benefits from parallelism or separate context. Respect a Yoke-owned loop and do not launch nested workers."
---

# Delegate bounded outcomes

Establish one controller. When Yoke owns execution, let it schedule workers, verification, review, and integration; a worker must not start another loop or native subagent tree. Without delegation support, execute serially and report any unavailable independent review.

Delegate only when the expected benefit exceeds the extra context, model calls, and coordination. Keep tightly coupled work together. Assign disjoint files or isolated worktrees, with explicit interfaces and integration order. Share one task budget across implementers, planners, critics, repairs, and review; do not reset a budget by starting a new agent.

Give each worker the objective, acceptance criteria, write scope, relevant source pointers, and concrete prior failure evidence. Use [implementer-prompt.md](implementer-prompt.md) as a handoff template. Do not resend the whole conversation or unrelated plans.

Accept a handoff with changed files, exact verification results, remaining risks, and artifact pointers. Resolve missing context directly; stop repeated failures when the budget or evidence no longer supports another attempt. The controller may fix a small integration issue itself.

Use one combined acceptance/correctness review at a meaningful integration boundary. Add a separate specialist review only for a specific risk or an explicit gate. Do not require two fresh reviewers after every tiny edit. [spec-reviewer-prompt.md](spec-reviewer-prompt.md) and [code-quality-reviewer-prompt.md](code-quality-reviewer-prompt.md) are optional focused templates, not mandatory sequential calls.

Check the actual diff and run required integrated checks before accepting the combined result. Self-checking remains useful but must not be reported as independent review. Re-review changed risks after a repair; reuse still-current evidence for unchanged parts.
