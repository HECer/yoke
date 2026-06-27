# Stop-the-Line Gates

These gates are enforced mechanically by the Loop (Baustein C) and expected of every agent run.

- **DoD gate:** Implementation may not begin until Definition of Done / Acceptance Criteria for the unit of work exist and are recorded (e.g., in the PRD story).
- **Green-tests gate:** A unit of work is not complete until its tests pass.
- **Clean-worktree gate:** No dispatch into a dirty or conflicted git worktree.
