import { describe, expect, it } from 'vitest'
import { rewriteHookInput } from '../../canon/tools/codex-rtk-hook.mjs'
import { spawnSync } from 'node:child_process'

describe('Codex RTK hook adapter', () => {
  it('returns the native Codex response including required permission decision', () => {
    const output = rewriteHookInput({
      hook_event_name: 'PreToolUse',
      permission_mode: 'default',
      tool_name: 'Bash',
      tool_input: { command: 'git status', timeout_ms: 1000 },
    }, () => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'RTK auto-rewrite', updatedInput: { command: 'rtk git status', timeout_ms: 1000 } } }))

    expect(output).toEqual({ hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'RTK auto-rewrite',
      updatedInput: { command: 'rtk git status', timeout_ms: 1000 },
    } })
  })

  it('probes the installed native processor with the real Codex schema', () => {
    const result = spawnSync('rtk', ['hook', 'codex'], { input: JSON.stringify({ hook_event_name: 'PreToolUse', permission_mode: 'default', tool_name: 'Bash', tool_input: { command: 'git status', timeout_ms: 1000 } }), encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).hookSpecificOutput).toMatchObject({ permissionDecision: 'allow', updatedInput: { command: 'rtk git status', timeout_ms: 1000 } })
  })

  it('fails open when native Codex hooks are unavailable or do not rewrite', () => {
    const input = { hook_event_name: 'PreToolUse', permission_mode: 'default', tool_name: 'Bash', tool_input: { command: 'git status' } }
    expect(rewriteHookInput(input, () => null)).toBeNull()
    expect(rewriteHookInput(input, () => { throw new Error('missing native hook') })).toBeNull()
    expect(rewriteHookInput({ ...input, permission_mode: 'futureMode' })).toBeNull()
  })

  it('returns null for unrelated or unchanged commands', () => {
    expect(rewriteHookInput({ tool_name: 'apply_patch', tool_input: {} })).toBeNull()
    expect(rewriteHookInput({ tool_name: 'Bash', tool_input: { command: 'rtk git status' } })).toBeNull()
  })
})
