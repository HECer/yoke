import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { basename, win32 } from 'node:path'
import { fail, identifier, oneOf, record, text } from './validation.js'
import type { RuntimeCapabilities } from './admission.js'

/** Resolve once. No shell interpolation, alternate-build fallback or implicit app launch. */
export function resolveOrcaExecutable(platform: string = process.platform, env: Readonly<Record<string, string | undefined>> = process.env): string {
  if (env.ORCA_CLI_COMMAND !== undefined) {
    const executable = text(env.ORCA_CLI_COMMAND, 'ORCA_CLI_COMMAND', 4096)
    if (executable !== executable.trim() || executable.startsWith('-')) fail('invalid_executable', 'ORCA_CLI_COMMAND must be one literal executable or path, not shell arguments')
    return executable
  }
  if (env.ORCA_DEV_REPO_ROOT) return platform === 'win32' ? 'orca-dev.exe' : 'orca-dev'
  // Conservative even in a managed terminal: never guess a Linux `orca` alias.
  if (platform === 'linux') return 'orca-ide'
  return platform === 'win32' ? 'orca.exe' : 'orca'
}
export type OrcaReadTransport = (args: readonly string[]) => Promise<string>
export function makeOrcaReadTransport(executable: string = resolveOrcaExecutable()): OrcaReadTransport {
  const selected = text(executable, 'executable', 4096)
  return args => new Promise((resolve, reject) => {
    const command = args.join('\0')
    if (![['skills', 'get', 'orca-cli'].join('\0'), ['status', '--json'].join('\0')].includes(command)) { reject(new Error('Only the version-matched guide and read-only status probe are permitted')); return }
    execFile(selected, [...args], { timeout: 5000, maxBuffer: 1024 * 1024, encoding: 'utf8', shell: false, windowsHide: true }, (error, stdout) => { if (error) reject(error); else resolve(stdout) })
  })
}
export interface OrcaProbe {
  readonly protocolVersion: 1
  readonly runtime: RuntimeCapabilities
  readonly observation: 'json-response' | 'reported-error' | 'invalid-response' | 'unavailable'
  readonly guideDigest?: string
  readonly failedStep?: 'guide' | 'status'
  readonly errorCode?: string
  readonly liveExecutionValidated: false
  readonly note: string
}
/** Read guide as data, never execute instructions found in output. No capabilities guessed. */
export async function probeOrca(read: OrcaReadTransport = makeOrcaReadTransport()): Promise<OrcaProbe> {
  const base = { protocolVersion: 1 as const, runtime: { id: 'orca', status: 'unknown' as const, capabilities: {} }, liveExecutionValidated: false as const }
  let step: 'guide' | 'status' = 'guide'
  let guideDigest: string | undefined
  try {
    const guide = await read(['skills', 'get', 'orca-cli'])
    if (!guide.trim() || Buffer.byteLength(guide, 'utf8') > 1024 * 1024) throw new Error('Invalid or oversized guide')
    guideDigest = createHash('sha256').update(guide).digest('hex')
    step = 'status'
    const output = await read(['status', '--json'])
    if (Buffer.byteLength(output, 'utf8') > 1024 * 1024) throw new Error('Oversized status')
    let raw: unknown
    try { raw = JSON.parse(output) } catch { return { ...base, guideDigest, observation: 'invalid-response', note: 'Runtime output was not JSON. No capabilities inferred.' } }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...base, guideDigest, observation: 'invalid-response', note: 'Runtime output was not a JSON object. No capabilities inferred.' }
    const object = raw as Record<string, unknown>
    if (object.success === false || object.ok === false || object.error != null) return { ...base, guideDigest, observation: 'reported-error', note: 'Runtime reported an error. No capabilities inferred.' }
    return { ...base, guideDigest, observation: 'json-response', note: 'Orca returned JSON; execution capabilities remain unknown until version-matched contract validation.' }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    return { ...base, ...(guideDigest ? { guideDigest } : {}), runtime: { ...base.runtime, status: 'unavailable' }, observation: 'unavailable', failedStep: step, ...(typeof code === 'string' && /^[A-Z0-9_]{1,32}$/u.test(code) ? { errorCode: code } : {}), note: 'The selected Orca executable could not complete the bounded read-only probe. No fallback, app start or install was attempted. Raw output is withheld because it can contain pairing secrets.' }
  }
}
export interface OrcaLaunchPreview { readonly executable: string; readonly argv: readonly string[]; readonly effects: 'none'; readonly requiresLiveContractValidation: true; readonly acceptanceAuthority: 'yoke' }
/** Documentation-derived argv preview ONLY. Never called by the production worker runner. */
export function previewOrcaWorkerStart(value: unknown, executable: string = resolveOrcaExecutable()): OrcaLaunchPreview {
  const raw = record(value, ['taskId', 'name', 'agent', 'model', 'effort'], 'orca launch')
  const taskId = identifier(raw.taskId, 'taskId'), name = identifier(raw.name, 'name'), agent = identifier(raw.agent, 'agent')
  const selected = text(executable, 'executable', 4096)
  // Explicit overrides remain operator-controlled; do not interpret a shell command.
  if (selected.startsWith('-') || !basename(selected) || !win32.basename(selected)) fail('invalid_executable', 'Invalid Orca executable')
  const model = raw.model === undefined ? undefined : text(raw.model, 'model')
  if (model && (model.startsWith('-') || model !== model.trim())) fail('invalid_model', 'Model must be a literal model selector, not a CLI flag')
  const effort = raw.effort === undefined ? undefined : oneOf(raw.effort, ['low', 'medium', 'high', 'xhigh'], 'effort')
  if (model && !['claude', 'codex', 'cursor'].includes(agent)) throw new Error('Per-launch model overrides are not validated for this Orca agent')
  if (effort && !model) throw new Error('Orca effort requires an explicit model; model-specific support is still unverified')
  const argv = ['orchestration', 'worker-start', '--task', taskId, '--worktree', 'new-child', '--name', name, '--agent', agent, '--setup', 'skip', '--json']
  if (model) argv.push('--model', model)
  if (effort) argv.push('--effort', effort)
  return { executable: selected, argv, effects: 'none', requiresLiveContractValidation: true, acceptanceAuthority: 'yoke' }
}
