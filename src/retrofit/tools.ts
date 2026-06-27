export interface McpServerConfig {
  command: string
  args: string[]
}

// Best-effort default launch commands. Users may need to adjust these to match
// their local install (e.g. graphify installed via `uv tool install graphifyy`).
export function mcpServers(): Record<string, McpServerConfig> {
  return {
    graphify: { command: 'graphify', args: ['serve'] },
    playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
  }
}

// rtk has no transparent-rewrite hook on Codex/Gemini; those agents get this
// instruction instead. On Claude (Windows) it is also the WSL-less fallback.
export function rtkInstruction(): string {
  return [
    '## Token efficiency (rtk)',
    '',
    'Prefix shell/dev commands with `rtk` to compress their output before it enters context.',
    'Example: `rtk git status`, `rtk npm test`. See https://github.com/rtk-ai/rtk.',
  ].join('\n')
}
