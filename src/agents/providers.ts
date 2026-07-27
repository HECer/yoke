import type { Agent } from '../retrofit/config.js'
import type { AgentInvocation, PermissionProfile } from './types.js'

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
  if (permissions === 'unsafe') return ['--yolo', '--output-format', 'stream-json']
  const approval = permissions === 'read-only' ? 'plan' : 'auto_edit'
  return ['--approval-mode', approval, '--sandbox', '--output-format', 'stream-json']
}

export function buildProviderInvocation(
  agent: Agent,
  prompt: string,
  cwd: string,
  permissions: PermissionProfile = 'safe',
): AgentInvocation {
  return { command: agent, args: argsFor(agent, permissions), input: prompt, cwd }
}
