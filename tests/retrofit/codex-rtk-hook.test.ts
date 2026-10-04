import { beforeEach, describe, expect, it, vi } from 'vitest'
import { rewriteHookInput } from '../../canon/tools/codex-rtk-hook.mjs'
import { spawnSync } from 'node:child_process'

const nativeProcess = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawnSync: nativeProcess }))

beforeEach(() => {
  nativeProcess.mockReset().mockImplementation((_command, _args, options) => {
    const input = JSON.parse(options.input)
    const command = input.tool_input?.command
    const supported = input.hook_event_name === 'PreToolUse' && input.permission_mode === 'default' && input.tool_name === 'Bash' && command === 'git status'
    return { status: 0, stdout: supported ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'RTK auto-rewrite', updatedInput: { ...input.tool_input, command: 'rtk git status' } } }) : '', stderr: '' }
  })
})

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

  it('delegates the real Codex schema to the native processor and preserves its response', () => {
    const input = { hook_event_name: 'PreToolUse', permission_mode: 'default', tool_name: 'Bash', tool_input: { command: 'git status', timeout_ms: 1000 } }
    expect(rewriteHookInput(input)?.hookSpecificOutput).toEqual({ hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'RTK auto-rewrite', updatedInput: { command: 'rtk git status', timeout_ms: 1000 } })
    expect(spawnSync).toHaveBeenCalledExactlyOnceWith('rtk', ['hook', 'codex'], { input: JSON.stringify(input), encoding: 'utf8', timeout: 3000 })
  })

  it('fails open when RTK is absent from the host', () => {
    nativeProcess.mockReturnValue({ status: null, stdout: null, stderr: null, error: Object.assign(new Error('spawnSync rtk ENOENT'), { code: 'ENOENT' }) })
    expect(rewriteHookInput({ hook_event_name: 'PreToolUse', permission_mode: 'default', tool_name: 'Bash', tool_input: { command: 'git status' } })).toBeNull()
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
