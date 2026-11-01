---
name: using-git-worktrees
description: "Create an isolated Git worktree when concurrent work or an existing dirty workspace requires it. Reuse a suitable task checkout rather than creating isolation for every small edit."
---

# Isolate work without losing state

Inspect the repository root, current branch, worktree list, and local changes. Reuse a suitable task checkout if available. Preserve unrelated changes; do not stash, reset, or remove them without authorization.

Choose the repository's existing worktree location or a task-specific external directory. If worktrees live inside the repository, ensure the directory is ignored before creation. Create a clearly named branch from the intended base and record its path and base commit.

Follow project dependency/setup instructions. Use lockfile-based installs and run enough baseline checks to distinguish pre-existing failures from the new change. Do not copy credentials or large generated trees into the worktree unnecessarily.

Keep one owner for each worktree and integrate through the host's normal process. Before cleanup, inspect its status and confirm the work is committed or otherwise retained. Never force-remove a dirty worktree merely to finish a checklist. Report the branch, changes, and remaining worktree when cleanup cannot safely complete.
