---
name: writing-plans
description: "Write a bounded execution plan when a change spans dependent tasks or needs a durable handoff. Use an existing approved specification; skip for a small change whose implementation and checks are already clear."
---

# Plan the work that needs coordination

Read the approved objective, relevant code, and constraints. Preserve the original acceptance criteria and explicit exclusions. Write the plan in the project's existing planning location; use `docs/plans/` only when no convention exists.

For each independently verifiable outcome, record:

- The behavior to change and the files or interfaces likely involved.
- Dependencies, ownership, allowed write scope, and compatibility constraints.
- The acceptance checks and evidence needed to detect a wrong result.
- Material failure modes, recovery, and any unresolved decision.

Group small edits that share one acceptance check. Split by independently testable outcomes, not arbitrary five-minute tasks or each line of code. Include code only for an important interface, protocol, or otherwise ambiguous example. Refer to existing implementation rather than copying complete files, repeated instructions, or every command's expected transcript into the plan.

Identify which steps can run independently and which require integration first. Include model calls only where judgment is necessary; use deterministic tools for discovery, validation, formatting, and bookkeeping. Set a shared call/time budget when the host supports it.

Check the plan for missing requirements, contradictory ordering, vague checks, and unjustified work. Continue execution if already authorized. A plan is a coordination artifact, not a reason to ask for approval again or to launch a second orchestration system.
