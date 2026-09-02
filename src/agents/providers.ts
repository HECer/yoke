import type { Agent } from '../retrofit/config.js'
import type { AgentInvocation, ModelSelection, PermissionProfile } from './types.js'
import { ModelSelectionSchema } from './contracts.js'

export {
  providerSpawnOptions,
  startProviderProcess,
  type ProviderProcessHandle,
  type ProviderProcessOptions,
  type ProviderProcessOutput,
  type ProviderProcessResult,
  type ProviderSpawnOptions,
} from './process.js'

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
    return ['exec', '--sandbox', 'workspace-write', '--approve-for-me', '--json']
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
  const parsedSelection = ModelSelectionSchema.parse(selection)
  const args = argsFor(agent, permissions)
  if (parsedSelection.model) args.push('--model', parsedSelection.model)
  if (parsedSelection.reasoningEffort) {
    if (agent === 'claude') args.push('--effort', parsedSelection.reasoningEffort)
    else if (agent === 'codex') args.push('--config', `model_reasoning_effort=${parsedSelection.reasoningEffort}`)
  }
  if (agent === 'codex' && parsedSelection.nativeMultiAgent === false) args.push('--disable', 'multi_agent')
  if (parsedSelection.bare) {
    if (agent === 'codex') args.push('--ignore-user-config')
    else if (agent === 'claude') args.push('--bare')
  }
  return { command: agent, args, input: prompt, cwd }
}
