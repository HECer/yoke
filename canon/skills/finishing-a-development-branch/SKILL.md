---
name: finishing-a-development-branch
description: "Complete an implemented branch through the already authorized integration path. Use when handing off finished work, creating a PR, or cleaning up an integrated worktree."
---

# Complete the authorized handoff

Inspect the branch, base, intended diff, local changes, and required check results. Finish missing authorized work and resolve blockers. Reuse still-current evidence; rerun required integration checks on the state being handed off.

Follow the user's chosen path. If a PR was requested, commit the task changes, push the branch, and create/update it. If merge or deployment was explicitly authorized, follow the repository gates. Otherwise do not infer that a PR request authorizes release or merge.

Do not force a four-option menu after every task. Ask only if the intended handoff remains materially unclear after useful preparation. Preserve unrelated work and inspect a worktree before removing it; never discard an uncommitted result to satisfy cleanup.

Report the actual branch/PR/result, checks, and remaining limitations. Do not claim a merge, release, or passing CI until observed.
