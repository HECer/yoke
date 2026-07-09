# Tool: claude-mem (persistent cross-session memory) — optional companion

External install (not bundled): `npx claude-mem install` — https://github.com/thedotmack/claude-mem (Apache-2.0).
Captures tool usage via lifecycle hooks, compresses it into SQLite + vector search, and injects
relevant context into future sessions.

Per-agent wiring:

- **Claude Code:** first-class support — its installer registers the lifecycle hooks itself. Yoke does not duplicate that wiring; run the installer once per machine.
- **Codex CLI / Gemini CLI:** supported by claude-mem's own multi-agent adapters; follow its docs.

Interaction with the Yoke loop (deliberate boundary):

- The loop's memory is **explicit and versioned**: `context/PROJECT.md`, `KNOWLEDGE.md`, `DECISIONS.md` plus the PRD. Every loop iteration starts from fresh context on purpose — reproducible, reviewable, in git.
- claude-mem's automatic injection is **for interactive sessions**, not for loop runs. Do not enable its hooks inside a loop runner profile: injected memory is non-deterministic and bypasses the context files the gates rely on.
