---
name: document-release
description: "Update documentation for an implemented behavior or authorized release. Use when requested to document changes, update release notes, or reconcile docs with a diff."
---

# Document the changed behavior

Read the actual diff, accepted requirements, current public interface, and repository documentation conventions. Identify affected users and migration consequences before editing.

Update only documents whose claims changed: usage, configuration, compatibility, examples, limitations, and release notes. Reuse the existing canonical location and link to it rather than repeating large instructions. Do not rewrite every documentation file because it exists.

Verify commands, flags, defaults, supported versions, and paths against code. Show runnable examples or label required user-supplied values. Explain unavailable or experimental behavior accurately; avoid turning an untested integration into a support claim.

Use a dated changelog entry when required. A documentation update or PR does not itself authorize a version bump or publication. For an authorized release, synchronize the repository's declared version sources and run its release metadata and packaging checks.

For an explicitly requested prose-style audit, use `no-ai-slop` and its `eval.md` guide as advisory guidance, not a mechanical gate.

Preserve the writer's voice and useful technical detail. Remove obsolete claims and unsupported performance numbers. Run relevant doc/link/schema checks and inspect the final diff. Commit/push when part of the authorized workflow; report the changes and verification without asking again for routine continuation.
