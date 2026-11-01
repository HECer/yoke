---
name: receiving-code-review
description: "Evaluate and act on review feedback using the code and acceptance criteria. Use when a review contains findings or requested changes, especially when the evidence is incomplete or disputed."
---

# Resolve findings with evidence

Read the complete review and the actual changed code. Separate reproducible defects, requirement gaps, optional improvements, and misunderstandings. Check the affected requirement and candidate identity before editing.

Fix confirmed blockers in dependency order. Add or run a discriminating regression check, then report the changed behavior and evidence. Batch related small fixes when they share a cause. Do not restate every review paragraph or launch a fresh model for straightforward mechanical edits.

When a finding is incorrect, explain the concrete counterevidence respectfully. When it depends on an unresolved product decision, state the tradeoff and ask only for that decision. Do not agree without checking, weaken protected acceptance, or add broad refactors to satisfy stylistic preference.

Request follow-up review for the repaired risks and any invalidated evidence. Preserve still-current review for unaffected scope. Use the configured independent gate where required; do not label the implementer's self-check independent.
