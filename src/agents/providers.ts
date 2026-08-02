import type { Agent } from '../retrofit/config.js'
import type { AgentInvocation, ModelSelection, PermissionProfile } from './types.js'

const argsFor = (agent: Agent, permissions: PermissionProfile): string[] => {
  if (agent === 'claude') {
    const mode = permissions === 'unsafe' ? 'bypassPermissions' : permissions === 'read-only' ? 'plan' : 'auto'
    const args = ['-p', '--permission-mode', mode]
    if (permissions === 'unsafe') args.push('--dangerously-skip-permissions')
    return [...args, '--output-format', 'stream-json', '--verbose']
  }
  if (agent === 'codex') {
    if (permissions === 'unsafe') return ['exec', '--dangerously-bypass-approvals-and-sandbox', '--json']
    if (permissions === 'read-only') return ['exec', '--sandbox', 'read-only', '--json']
    return ['exec', '--full-auto', '--json']
  }
  if (permissions === 'unsafe') return ['--yolo']
  const approval = permissions === 'read-only' ? 'plan' : 'auto_edit'
  return ['--approval-mode', approval, '--sandbox']
}

export function buildProviderInvocation(
  agent: Agent,
  prompt: string,
  cwd: string,
  permissions: PermissionProfile = 'safe',
  selection: ModelSelection = {},
): AgentInvocation {
  const args = argsFor(agent, permissions)
  if (selection.model) args.push('--model', selection.model)
  if (selection.reasoningEffort) {
    if (agent === 'claude') args.push('--effort', selection.reasoningEffort)
    else if (agent === 'codex') args.push('--config', `model_reasoning_effort=${selection.reasoningEffort}`)
  }
  if (agent === 'codex' && selection.nativeMultiAgent === false) args.push('--disable', 'multi_agent')
  if (selection.bare) {
    if (agent === 'codex') args.push('--ignore-user-config')
    else if (agent === 'claude') args.push('--bare')
  }
  return { command: agent, args, input: prompt, cwd }
}
