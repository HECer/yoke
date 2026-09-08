import { mergeJson } from './merge-json.js'

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Remove only Yoke 1.11's inert Gemini-shaped hook, preserving unrelated hooks. */
export function mergeQwenSettings(current: unknown, incoming: unknown): unknown {
  if (!record(current) || !record(current.hooks) || !Array.isArray(current.hooks.BeforeTool)) return mergeJson(current, incoming)
  const beforeTool = current.hooks.BeforeTool.flatMap(group => {
    if (!record(group) || group.matcher !== '^run_shell_command$' || !Array.isArray(group.hooks)) return [group]
    const hooks = group.hooks.filter(hook => !(record(hook) && hook.name === 'yoke-rtk' && hook.type === 'command' && hook.command === 'node .qwen/hooks/qwen-rtk-hook.mjs'))
    return hooks.length ? [{ ...group, hooks }] : []
  })
  const hooks = { ...current.hooks, BeforeTool: beforeTool }
  if (!beforeTool.length) delete (hooks as Record<string, unknown>).BeforeTool
  return mergeJson({ ...current, hooks }, incoming)
}
