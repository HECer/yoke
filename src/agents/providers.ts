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
  if (permissions === 'unsafe') return ['--yolo', '--output-format', 'stream-json']
  const approval = permissions === 'read-only' ? 'plan' : 'auto_edit'
  return ['--approval-mode', approval, '--sandbox', '--output-format', 'stream-json']
}

export function buildProviderInvocation(
  agent: Agent,
  prompt: string,
  cwd: string,
  permissions: PermissionProfile = 'safe',
  selection: ModelSelection = {},
  output: { schemaFile?: string; jsonSchema?: Record<string, unknown> } = {},
): AgentInvocation {
  const parsedSelection = ModelSelectionSchema.parse(selection)
  if (agent === 'gemini' && parsedSelection.bare) throw new Error('Gemini does not support the bare startup selection')
  if (agent === 'gemini' && parsedSelection.reasoningEffort) throw new Error('Gemini does not support the reasoningEffort selection')
  if (agent === 'gemini' && parsedSelection.nativeMultiAgent !== undefined) throw new Error('Gemini does not support the nativeMultiAgent selection')
  const args = argsFor(agent, permissions)
  if (output.schemaFile !== undefined || output.jsonSchema !== undefined) {
    if (agent === 'codex' && output.schemaFile && output.jsonSchema === undefined) {
      if (/[\0\r\n]/u.test(output.schemaFile) || (process.platform === 'win32' && !/^[A-Za-z0-9_./:\\-]+$/u.test(output.schemaFile))) throw new Error('Invalid output schema file path')
      args.push('--output-schema', output.schemaFile)
    } else if (agent === 'claude' && output.jsonSchema && output.schemaFile === undefined) {
      const schema = JSON.stringify(output.jsonSchema)
      if (process.platform === 'win32') throw new Error('Inline structured output is unsupported by the Windows provider shell shim')
      args.push('--json-schema', schema)
    } else throw new Error(`${agent} structured output schema requires ${agent === 'codex' ? 'schemaFile' : agent === 'claude' ? 'jsonSchema' : 'a supported native schema option (unavailable)'}`)
  }
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
