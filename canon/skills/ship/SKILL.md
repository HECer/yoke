---
name: ship
description: "Prepare and open or update a pull request for an implemented change. Use when asked to ship a branch or create a PR; merging, deploying, and publishing require their own task authorization."
---

# Prepare the change for review

Inspect repository instructions, the remote, base branch, current branch, and working tree. Include only the intended task changes; preserve unrelated user work. Create a feature branch if necessary. Reuse authorization already given for the requested handoff.

Refresh the base and resolve relevant conflicts before final verification. Follow the repository's merge/rebase convention, preserve others' commits, and never force-push a shared branch without explicit authorization.

Review the actual diff against the accepted objective. Run required type, lint, behavioral, integration, and packaging checks. Add a regression test for a concrete defect or changed behavior; do not invent an AI-estimated coverage percentage or bootstrap a test framework for a prose-only change. Record unrun platform/provider checks accurately. Reuse evidence only when the tested inputs and environment still match.

Use one independent review where available or required. Resolve blocking findings; do not duplicate a still-current review or run a model merely to restate a green test result. If necessary review or external validation is unavailable, open a draft and state the limitation.

Update documentation and a changelog when behavior or the repository's release rules require it. Bump versions only as part of an authorized release and synchronize all required manifests. Creating a PR alone does not call for a version bump, package publication, production deployment, or merge.

Stage explicit task paths, inspect the staged diff for unintended files and secrets, and commit with the configured user identity. Respect co-author policy. Push the feature branch and create or update the PR using the available Git provider. Explain the problem, changed behavior, validation, and material limits. Supply multiline bodies through a structured argument or a file to avoid shell expansion.

Check the resulting branch/PR identity and CI state. Fix failures caused by the change when possible. Report the PR URL and actual CI status; do not claim completion from a submitted command alone.
