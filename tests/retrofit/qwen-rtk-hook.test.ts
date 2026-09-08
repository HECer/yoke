import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const run = (event: unknown) => spawnSync(process.execPath, [resolve('canon/tools/qwen-rtk-hook.mjs')], { input: JSON.stringify(event), encoding: 'utf8' })
describe('Qwen RTK PreToolUse hook', () => {
  it('requires an RTK retry through Qwen native denial without granting permission', () => {
    const result = run({ hook_event_name: 'PreToolUse', tool_name: 'run_shell_command', tool_input: { command: 'git status', timeout: 3 } })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Retry this command through RTK: rtk git status' } })
  })
  it.each(['git status && whoami', 'rg hello | cat', 'rtk git status', 'echo hello'])('leaves complex or unsupported commands untouched: %s', command => {
    expect(JSON.parse(run({ hook_event_name: 'PreToolUse', tool_name: 'run_shell_command', tool_input: { command } }).stdout)).toEqual({})
  })
  it('fails closed on malformed shell input', () => {
    expect(run({ hook_event_name: 'PreToolUse', tool_name: 'run_shell_command', tool_input: {} }).status).toBe(2)
  })
})
