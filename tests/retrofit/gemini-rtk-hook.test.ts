import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { planGemini } from '../../src/retrofit/planners/gemini.js'

const hook = resolve('canon/tools/gemini-rtk-hook.mjs')
const run = (input: unknown) => spawnSync(process.execPath, [hook], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' })

describe('Gemini RTK hook', () => {
  it('rewrites a supported command and preserves other tool arguments', () => {
    const result = run({ hook_event_name: 'BeforeTool', tool_name: 'run_shell_command', tool_input: { command: 'git status', description: 'status', dir_path: '/repo' } })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).hookSpecificOutput.tool_input).toEqual({ command: 'rtk git status', description: 'status', dir_path: '/repo' })
  })
  it('maps ripgrep to the RTK grep subcommand', () => {
    expect(JSON.parse(run({ tool_name: 'run_shell_command', tool_input: { command: 'rg pattern src' } }).stdout).hookSpecificOutput.tool_input.command).toBe('rtk grep pattern src')
  })
  it.each(['rtk git status', '  rtk proxy npm test', 'echo $(touch sentinel)', 'git status && echo next'])('preserves already wrapped or complex commands: %s', command => {
    expect(JSON.parse(run({ tool_name: 'run_shell_command', tool_input: { command } }).stdout)).toEqual({})
  })
  it.each(['bad json', 'null', '{"tool_name":"run_shell_command","tool_input":{"command":42}}'])('rejects malformed input safely: %s', input => {
    const result = run(input)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Invalid')
  })
  it('installs a portable hook and mergeable settings', () => {
    const actions = planGemini(resolve('canon'), '/repo')
    expect(actions.some(a => a.target === '.gemini/hooks/gemini-rtk-hook.mjs')).toBe(true)
    const settings = actions.find(a => a.target === '.gemini/settings.json')!
    expect(settings.merge).toBe(true)
    expect(JSON.parse(String(settings.content)).hooks.BeforeTool[0]).toEqual({ matcher: '^run_shell_command$', hooks: [{ name: 'yoke-rtk', type: 'command', command: 'node .gemini/hooks/gemini-rtk-hook.mjs' }] })
  })
})
