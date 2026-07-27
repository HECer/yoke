# Migrating to Yoke 1.0

Yoke 1.0 changes unsafe implicit behavior into explicit policy.

## Runner permissions

The default is `runner.permissions: safe`. Automation that intentionally requires a full
sandbox bypass must pass `--unsafe` or configure `runner.permissions: unsafe`. Use
`read-only` for planning and probing.

## Reviews

Reviewers write `.yoke/review-verdict.json`; Yoke validates and consumes it. The reviewer must
differ from the implementer unless `--allow-self-review` is explicit. CI can add `--json`.

## Commit ownership

Yoke resolves identity before implementation. Configure it when Git has no identity:

```yaml
commit:
  authorName: HECer
  authorEmail: hec_er@web.de
  allowCoAuthors: false
```

## PRDs, audit, and cleanup

Existing PRDs remain valid. Optional `needs`, `area`, and `agent` fields add dependencies,
collision domains, and affinity. Enable the story audit gate with `audit.enabled: true` and
version suppressions with `suppressionsVersion: 1`.

`yoke loop cleanup` now reports retained worktrees. Add `--remove-worktrees` for deletion.
