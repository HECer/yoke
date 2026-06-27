# Role Separation

The agent that performs a role must not also perform a conflicting one:

- **Implementer ≠ Reviewer** — implementation is not self-reviewed.
- **Implementer ≠ Merger** — the implementer does not merge their own change.
- **Implementer ≠ Security auditor** — security is not self-audited.

In the Loop, these map to separate iterations with fresh context.
