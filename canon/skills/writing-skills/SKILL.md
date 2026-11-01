---
name: writing-skills
description: "Create or revise repository-owned skills so they trigger precisely, use little context, and produce verifiable outcomes. Use for an actual skill authoring request, not as a mandatory prelude to ordinary work."
---

# Write a focused reusable skill

Inspect the target package, its ownership, manifest, adapters, and repository conventions. Edit only the requested skill sources; do not modify installed third-party skills or install a second copy merely to change repository assets.

State one clear capability and a narrow trigger in frontmatter. Keep the entrypoint short. Include only decisions, constraints, commands, or failure modes that the consuming agent cannot reliably infer. Preserve required metadata and attribution.

Place specialized examples, prompt templates, and detailed reference material in named companion files. Link each resource with a concrete condition for reading it. Do not make an agent load the whole package, copy full transcripts, or repeat the same rule across several skills.

Prefer concise executable steps and explicit acceptance evidence. Respect host capabilities, existing user authorization, and one controller's budget. Avoid unconditional tool names, mandatory approval loops, blanket test-first rules for nonbehavioral edits, or a skill that automatically invokes several other skills.

Validate manifest/frontmatter/resource links using the repository's validator. For a behavioral workflow revision, exercise representative tasks, including a case that should not trigger it and a missing-capability case. Use a fresh independent agent when available and useful, with the task and skill rather than the expected answer. Report validation limits.

Measure source/prompt bytes separately from actual token usage. Confirm the shorter workflow preserves required checks and accepted outcomes. Commit and sync the repository changes through its normal review workflow; do not claim installation or empirical savings that were not observed.
