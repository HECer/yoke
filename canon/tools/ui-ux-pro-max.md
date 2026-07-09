# Tool: ui-ux-pro-max (design intelligence) — optional companion

External install (not bundled): `npm i -g ui-ux-pro-max-cli && uipro init --ai claude` —
https://github.com/nextlevelbuilder/ui-ux-pro-max-skill (MIT).
A data-driven design skill: UI styles, industry reasoning rules, palettes, font pairings,
chart types, per-stack guidance. Its own installer targets Claude Code, Codex CLI, and
Gemini CLI natively — run `uipro init` once per agent you use.

Why it pairs with Yoke instead of being vendored:

- **Division of labour:** ui-ux-pro-max makes the *generation* side better (what to build);
  Yoke's `unslop-ui` skill, `yoke design-scan`, and `visual-verification` are the *verification*
  side (prove it doesn't look AI-generated, prove it renders). Generate with pro-max, gate with Yoke.
- **Not vendored on purpose:** it ships its own installer and update cadence; a copy frozen into
  the canon would go stale. Install it directly and let `uipro update` keep it current.
