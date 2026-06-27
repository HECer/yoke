# Loop Specification (Ralph + GSD)

The autonomous loop is OPTIONAL and toggle-able (`forge loop on|off`). When enabled:

1. Pre-dispatch gates: missing tools / dirty worktree / git conflict → `blocked`.
2. Pick the highest-priority unfinished PRD story.
3. Stop-the-Line gate: DoD/AC present, else `blocked`.
4. Spawn a fresh agent (claude -p | codex exec | gemini) in a git worktree.
5. Implement ONE story → tests green → review iteration (different role).
6. Update the PRD (`passes: true`) + atomic commit.
7. Stop when all stories `passes: true`, or the iteration cap is reached.

State lives outside the model context: the PRD file + git. Full driver is built in Baustein C.
