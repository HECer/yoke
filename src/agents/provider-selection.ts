import type { Agent, ModelSelection } from './contracts.js'

/** Runner defaults belong to the runner that selected them. Undefined overrides
 * are absent; explicit false values (for example bare: false) still override. */
export function resolveProviderSelection(
  agent: Agent,
  defaults?: ModelSelection & { agent?: Agent },
  overrides: ModelSelection = {},
): ModelSelection {
  const inherited = defaults && (defaults.agent ?? 'codex') === agent ? defaults : {}
  const result: ModelSelection = {}
  for (const key of ['provider', 'model', 'reasoningEffort', 'variant', 'bare', 'nativeMultiAgent'] as const) {
    const value = overrides[key] ?? inherited[key]
    if (value !== undefined) Object.assign(result, { [key]: value })
  }
  return result
}
