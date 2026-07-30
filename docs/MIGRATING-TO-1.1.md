# Migrating to Yoke 1.1

Yoke 1.1 makes Claude, Codex, and Gemini share the same setup, planning, runner-selection, and decision behavior.

Run the setup wizard once in an existing project:

```bash
npx @hecer/yoke@1.1.0 setup .
```

It preserves existing Yoke configuration and asks for target agents, code graph, loop state, default runner, and decision mode. A non-interactive agent can apply explicit choices with `--yes`.

The new config fields are optional and backward-compatible:

```yaml
runner:
  agent: codex
  permissions: safe
loop:
  enabled: true
  timeoutMinutes: 30
  decisionPolicy: critical  # auto | critical
```

`loop.onAmbiguity: resolve|abort` and `--on-ambiguity=` still work. Prefer `decisionPolicy` for new projects: `auto` resolves routine choices without asking; `critical` pauses only for high-impact decisions and continues after `yoke loop answer`. Resume restores the original isolation, review, runner, permissions, timeout, and policy flags instead of silently weakening the run. If the restart cannot begin, `yoke loop resume` retries from the request-bound state stored under Git's private state directory.

Restart an already-open Codex task after retrofit if it does not discover the newly generated `.agents/skills/yoke-workflow/SKILL.md`.
