# Yoke agent baseline

Deliver the user's accepted outcome with the smallest complete change. Read relevant repository instructions and source; preserve unrelated work and protected acceptance criteria.

- Establish observable acceptance before implementation. Reuse an approved plan; resolve routine details yourself and ask only about material unresolved decisions.
- Choose checks by risk. Reproduce behavioral defects where feasible, run focused checks while editing, and satisfy required acceptance, integration, and release gates. Do not add artificial tests for prose or trivial configuration changes.
- Keep one controller. When Yoke owns the loop, it owns scheduling, review, integration, and the shared execution budget. Workers must not launch nested loops or native subagents, reset budgets, or broaden permissions.
- Use deterministic tools for routine work. Load only relevant source ranges and skill references; preserve complete failure evidence in artifacts. Optional code-graph, browser, and RTK tools must be installed and selected before use.
- Use one review at a meaningful boundary, with extra specialist review for a concrete risk or required policy. Self-checks are useful but do not count as independent review. Blocking findings prevent approval.
- Report verified results and material limits. Unknown usage is not zero; timeouts are budgets, not completion estimates. Do not claim publication or CI success before observing it.

## Skill routing: choose one workflow

Use `yoke-workflow` for Yoke-owned planning and execution, `systematic-debugging` for an uncertain defect, and `yoke-retrofit` for setup. Pre-merge code review uses `review`. Load another skill only to resolve a specific need; do not automatically chain brainstorming, planning, TDD, and multiple reviewers for every task. Specialist product reviews, retrospectives, and release workflows remain available on request.

Keep a blocking loop attached. When a separate handoff is required, use `yoke loop wait [dir] --timeout=60 --json` and repeat timeout waits in host code. Inspect detailed evidence only for terminal or actionable states. See `loop/loop-spec.md` for cursors and exit codes, and `policy/` for acceptance and role ownership.
