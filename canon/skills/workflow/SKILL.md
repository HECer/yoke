---
name: workflow
description: "Coordinate a multi-step software change when no more specific workflow applies. Use yoke-workflow when Yoke owns the backlog and loop; do not apply every methodology to every task."
---

# Deliver an accepted change

Read the user's objective, repository instructions, and relevant code. Establish enough acceptance evidence to distinguish success from a plausible implementation. Reuse an existing specification or approved plan.

Resolve material uncertainty, then implement the smallest complete change. Write a plan only when dependencies or a handoff require it. Reproduce behavioral defects where feasible and choose checks that can detect the relevant failure. Run focused checks during iteration and all required acceptance, integration, and release gates at their boundaries.

Keep one execution controller and a shared budget. Load only the specific skill needed for the current uncertainty. Use deterministic actions for routine work; do not automatically chain brainstorming, a full plan, multiple reviewers, and a release process.

Inspect the integrated diff, resolve blockers, and complete the authorized handoff. A PR does not imply a version bump, merge, deployment, or package publication. Report what changed, the evidence, and material unverified risks.
