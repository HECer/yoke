# Tool: Playwright MCP

Use browser tools when UI inspection or interaction is required. Select them explicitly with `yoke setup . --browser-tools` or `yoke retrofit . --browser-tools`. New setups do not expose browser tools automatically. Generated launch configuration pins `@playwright/mcp@0.0.84`; verify compatibility before updating that pin.

Claude, Codex, Gemini, Qwen, OpenCode, and Kilo receive their native MCP configuration. Pi and Hermes use available host browser capabilities or explicit Yoke smoke gates. `--no-browser-tools` removes recognized Yoke browser launch entries while preserving unrelated JSON-configured servers.

The browser server is a local executable with access determined by its host. Choosing it does not establish a sandbox or authorize unrelated website actions. Keep functional acceptance and source-bound screenshot evidence separate from optional visual-style heuristics.
