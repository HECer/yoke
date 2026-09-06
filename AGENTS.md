# Yoke project context

For product strategy, roadmap, provider parity, token/cost optimization, task time estimation, or dashboard work, first read [the saved product discussion](docs/PRODUCT-DIRECTION-2026-09-05.md).

That document distinguishes observed code findings, user preferences, and proposed features. Do not treat proposals as implemented functionality or blanket authorization to implement them. Recheck dated findings against the current code. This file complements the user's global instructions.

## Release rule

Every new version must have a dated entry in CHANGELOG.md before it is tagged or published. Describe the implemented features, behavior/default changes, fixes, migration or override instructions, and material validation limits that apply to that release. Keep proposals separate from shipped functionality. Synchronize package, lockfile, provider manifests and README versions, run the release checks, and use the matching changelog entry for GitHub release notes. Verify GitHub CI and npm publication before reporting the release as complete.
