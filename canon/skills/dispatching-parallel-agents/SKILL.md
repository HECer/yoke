---
name: dispatching-parallel-agents
description: "Delegate independent work when concurrent execution can reduce elapsed time without conflicting writes or hidden dependencies. Respect host capacity and shared execution budgets."
---

# Parallelize independent work

Identify tasks that can finish and be verified independently. Keep tasks that share evolving interfaces or mutable state together until those dependencies stabilize. Use native host delegation only when available; inside a Yoke worker, let the host loop schedule work.

Assign each worker an objective, relevant context, allowed paths, acceptance evidence, and a bounded budget. Use disjoint file ownership or separate worktrees. Agree on interface contracts before dependent implementation. Do not broadcast the full repository or conversation to every worker.

Limit concurrency to actual tool capacity and shared call/time/resource limits. Retain one integrator. Require concise handoffs with changed files, check results, blockers, and artifacts. Surface conflicts promptly instead of silently overwriting another worker's changes.

Integrate in dependency order and run meaningful cross-boundary checks. Measure accepted outcomes and elapsed time; parallel model calls may reduce wall time while increasing tokens and coordination cost. Stop workers whose results are no longer needed and do not spawn a second orchestration layer.
