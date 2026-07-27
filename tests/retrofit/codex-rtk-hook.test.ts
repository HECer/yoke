import { describe, expect, it } from 'vitest'
import { rewriteHookInput } from '../../canon/tools/codex-rtk-hook.mjs'

describe('Codex RTK hook adapter', () => {
  it('returns a PreToolUse updatedInput when RTK rewrites a Bash command', () => {
    const output = rewriteHookInput({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git status', timeout_ms: 1000 },
    }, () => 'rtk git status')

    expect(output).toEqual({ hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      updatedInput: { command: 'rtk git status', timeout_ms: 1000 },
    } })
  })

  it('returns null for unrelated or unchanged commands', () => {
    expect(rewriteHookInput({ tool_name: 'apply_patch', tool_input: {} }, () => 'x')).toBeNull()
    expect(rewriteHookInput({ tool_name: 'Bash', tool_input: { command: 'ls' } }, () => 'ls')).toBeNull()
  })
})
