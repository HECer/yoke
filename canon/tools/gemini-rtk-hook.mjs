#!/usr/bin/env node
// Pure BeforeTool argument adapter. Never evaluates or executes tool commands.
import { readFileSync } from 'node:fs'

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
try {
  const event = JSON.parse(readFileSync(0, 'utf8'))
  if (!record(event) || typeof event.tool_name !== 'string' ||
      (event.hook_event_name !== undefined && event.hook_event_name !== 'BeforeTool')) throw new Error('event')
  let response = {}
  if (event.tool_name === 'run_shell_command') {
    if (!record(event.tool_input) || typeof event.tool_input.command !== 'string' || !event.tool_input.command.trim() || event.tool_input.command.includes('\0')) throw new Error('command')
    const command = event.tool_input.command
    // Restrict rewriting to simple supported invocations. Leave shell syntax,
    // quoted executables, assignments and existing RTK wrappers untouched.
    if (!/[;&|<>`$\r\n()]/u.test(command) && /^\s*(?:git|rg|npm|npx|cargo|pytest|go|docker|kubectl)\s/u.test(command)) {
      const rewritten = command.trimStart().replace(/^rg\s/u, 'grep ')
      response = { hookSpecificOutput: { tool_input: { ...event.tool_input, command: `rtk ${rewritten}` } } }
    }
  }
  process.stdout.write(JSON.stringify(response) + '\n')
} catch {
  process.stderr.write('Invalid Gemini BeforeTool hook input\n')
  process.exitCode = 2
}
