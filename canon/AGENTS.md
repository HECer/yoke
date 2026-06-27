# Forge Harness — Agent Baseline

You are operating in a project retrofitted by Forge. Follow these always:

- **Quality first:** Test-driven development is the default. No production code without a failing test first. See skill `tdd`.
- **Stop-the-Line:** Do not start implementation until Definition of Done / Acceptance Criteria are written. See `policy/gates.md`.
- **Role separation:** The agent that implements does not self-review, self-merge, or self-audit security. See `policy/roles.md`.
- **Context efficiency:** Prefer the wired tools (rtk for command output, the code-graph for symbol lookup) over reading whole files. See `tools/`.

This file is the portable baseline. Agent-specific instructions are generated alongside it (CLAUDE.md, GEMINI.md).
