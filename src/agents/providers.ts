import type { Agent } from '../retrofit/config.js'
import type { AgentInvocation, ModelSelection, PermissionProfile } from './types.js'
import { ModelSelectionSchema } from './contracts.js'
import { fileURLToPath } from 'node:url'

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
    // Automatic review already selects workspace-write and conflicts with --sandbox.
    return ['exec', '--approve-for-me', '--json']
  }
  // Qwen Code uses its own approval modes and native tool exclusions.
  if (agent === 'qwen') {
    if (permissions === 'unsafe') return ['--yolo', '--output-format', 'stream-json']
    const approval = permissions === 'read-only' ? 'plan' : 'auto-edit'
    return ['--approval-mode', approval, '--sandbox', '--output-format', 'stream-json', ...(permissions === 'safe' ? ['--allowed-tools', 'run_shell_command'] : [])]
  }
  if (agent === 'opencode' || agent === 'kilo') {
    const args = ['run', '--format', 'json', '--auto']
    if (permissions === 'read-only') args.push('--agent', 'plan')
    if (permissions === 'unsafe') args.push('--dangerously-skip-permissions')
    return args
  }
  if (agent === 'pi') {
    const args = ['--mode', 'json', '--no-session']
    if (permissions !== 'unsafe') args.push('--tools', permissions === 'read-only' ? 'read,grep,find,ls' : 'read,bash,edit,write')
    return args
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
  if (agent === 'gemini' && parsedSelection.nativeMultiAgent === true) throw new Error('Gemini does not support enabling the nativeMultiAgent selection')
  if (agent === 'qwen' && parsedSelection.bare) throw new Error('Qwen does not support the bare startup selection')
  if (agent === 'qwen' && parsedSelection.reasoningEffort) throw new Error('Qwen does not support the reasoningEffort selection')
  if (agent === 'qwen' && parsedSelection.nativeMultiAgent === true) throw new Error('Qwen does not support enabling the nativeMultiAgent selection')
  if (parsedSelection.provider && !['opencode', 'kilo', 'pi'].includes(agent)) throw new Error(`${agent} does not support an explicit provider selection`)
  if (parsedSelection.variant && !['opencode', 'kilo', 'pi'].includes(agent)) throw new Error(`${agent} does not support a model variant selection`)
  const args = argsFor(agent, permissions)
  if (output.schemaFile !== undefined || output.jsonSchema !== undefined) {
    if (agent === 'codex' && output.schemaFile && output.jsonSchema === undefined) {
      if (/[\0\r\n]/u.test(output.schemaFile) || (process.platform === 'win32' && !/^[A-Za-z0-9_./:\\-]+$/u.test(output.schemaFile))) throw new Error('Invalid output schema file path')
      args.push('--output-schema', output.schemaFile)
    } else if (agent === 'claude' && output.jsonSchema && output.schemaFile === undefined) {
      const schema = JSON.stringify(output.jsonSchema)
      if (process.platform === 'win32') throw new Error('Inline structured output is unsupported by the Windows provider shell shim')
      args.push('--json-schema', schema)
    } else if (!['opencode', 'kilo', 'pi'].includes(agent)) throw new Error(`${agent} structured output schema requires ${agent === 'codex' ? 'schemaFile' : agent === 'claude' ? 'jsonSchema' : 'a supported native schema option (unavailable)'}`)
  }
  if (parsedSelection.provider && agent === 'pi') args.push('--provider', parsedSelection.provider)
  if (parsedSelection.model) {
    const qualified = agent === 'qwen' && parsedSelection.model.includes('::')
      ? parsedSelection.model.match(/^(openai|anthropic|gemini|vertex-ai|qwen-oauth)::(.+)$/u) : undefined
    if (agent === 'qwen' && parsedSelection.model.includes('::') && !qualified) throw Error('Invalid Qwen auth/model selector')
    if (qualified) {
      const model = ModelSelectionSchema.shape.model.parse(qualified[2])!
      args.push('--auth-type', qualified[1]!, '--model', model)
    }
    else {
      const qualified = parsedSelection.provider && (agent === 'opencode' || agent === 'kilo')
        ? `${parsedSelection.provider}/${parsedSelection.model}`
        : parsedSelection.model
      args.push('--model', qualified)
    }
  }
  if (parsedSelection.reasoningEffort) {
    if (agent === 'claude') args.push('--effort', parsedSelection.reasoningEffort)
    else if (agent === 'codex') args.push('--config', `model_reasoning_effort=${parsedSelection.reasoningEffort}`)
    else if (agent === 'opencode' || agent === 'kilo') args.push('--variant', parsedSelection.reasoningEffort)
    else if (agent === 'pi') args.push('--thinking', parsedSelection.reasoningEffort)
  }
  if (parsedSelection.variant) {
    if (agent === 'opencode' || agent === 'kilo') args.push('--variant', parsedSelection.variant)
    else if (agent === 'pi') {
      if (parsedSelection.reasoningEffort && parsedSelection.reasoningEffort !== parsedSelection.variant) throw new Error('Pi reasoningEffort and variant selections must match')
      if (!parsedSelection.reasoningEffort) args.push('--thinking', parsedSelection.variant)
    }
  }
  if (agent === 'codex' && parsedSelection.nativeMultiAgent === false) args.push('--disable', 'multi_agent')
  if (agent === 'claude' && parsedSelection.nativeMultiAgent === false) args.push('--disallowedTools', 'Agent', 'Task', 'TeamCreate', 'SendMessage')
  if (agent === 'qwen' && parsedSelection.nativeMultiAgent === false) {
    args.push('--exclude-tools', 'agent', 'task', 'create_sub_session', 'team_create', 'send_message')
  }
  if (parsedSelection.bare) {
    if (agent === 'codex') args.push('--ignore-user-config')
    else if (agent === 'claude') args.push('--bare')
    else if (agent === 'opencode' || agent === 'kilo') args.push('--pure')
    else if (agent === 'pi') throw new Error('Pi does not support the bare startup selection')
  }
  if (agent === 'gemini' && parsedSelection.nativeMultiAgent === false) {
    return { command: process.execPath, args: [fileURLToPath(new URL('../../hooks/bounded-gemini.mjs', import.meta.url)), ...args], input: prompt, cwd }
  }
  return { command: agent, args, input: prompt, cwd }
}
