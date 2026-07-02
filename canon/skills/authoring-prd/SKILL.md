---
name: authoring-prd
description: Use when turning a product idea into a loop-ready .yoke/prd.yaml — slice the idea into small, independently shippable stories with testable behavioral acceptance criteria; greenfield STORY-1 scaffolds the project and wires verify.command.
---

# Authoring a PRD

The Yoke loop is only as good as its stories. Bad stories ("build the app") stall it;
good stories (small, testable, ordered) let it run overnight.

## Story rules

1. **One iteration per story.** If you can't imagine an agent finishing it in one sitting,
   split it. Prefer 5-12 stories over 3 epics.
2. **Independently shippable.** After any story, the project builds and tests pass.
3. **Acceptance = observable behavior**, never implementation:
   - Good: "GET /health returns 200", "the CLI prints the sum of its arguments"
   - Bad: "create a HealthController class", "use express"
   2-5 criteria per story. Each must be checkable by a test or a command.
4. **Dense priorities from 1**; lower runs first. Order by dependency, then by risk.
5. **Greenfield: STORY-1 scaffolds.** Project skeleton + runnable test suite + a criterion
   that the verify command (`verify.command` in `.yoke/config.yaml`) exits 0. Every later
   story stands on a green pipeline.

## Format (`.yoke/prd.yaml`)

```yaml
- id: STORY-1
  title: scaffold a TypeScript CLI with vitest
  priority: 1
  acceptance:
    - "npm test exits 0 with at least one passing test"
    - "verify.command is set in .yoke/config.yaml"
  passes: false
- id: STORY-2
  title: add the sum command
  priority: 2
  acceptance:
    - "cli sum 1 2 prints 3"
    - "non-numeric input exits 1 with an error message"
  passes: false
```

`passes` is owned by the loop — always start `false`. Validate with `yoke prd check`.
