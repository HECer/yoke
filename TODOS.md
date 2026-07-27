# Yoke follow-up work

- Wire the tested async parallel dispatcher to provider subprocess workers. Until then the CLI
  rejects `--parallel=N` for `N > 1`; scheduler, claims, and merge queue APIs are available
  without claiming a CLI speed-up.
- Add provider-native output schemas when all three CLIs expose compatible stable APIs.
- Expand benchmark fixtures and collect multiple authenticated samples per provider/model.
- Add signed provenance and attestations to npm and GitHub releases.
