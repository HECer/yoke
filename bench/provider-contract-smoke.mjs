// Availability is not compatibility. The default mode makes no model calls.
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CONTRACT_VERSION = 'yoke-provider-contract/2026-11/v1'

/** A successful process or a matching nonce alone is not a contract pass. */
export function assessContract(parsed, result, nonce, unchanged) {
  const structuredResult = parsed !== null && typeof parsed === 'object'
    && parsed.schemaVersion === 1 && parsed.nonce === nonce
    && Object.keys(parsed).sort().join(',') === 'nonce,schemaVersion'
  const processSucceeded = result.kind === 'succeeded'
  const completeOutput = result.stdoutTruncated === false && result.stderrTruncated === false
  const passed = processSucceeded && completeOutput && structuredResult && unchanged
  return {
    status: passed ? 'passed' : 'failed',
    checks: { processSucceeded, completeOutput, structuredResult, workspaceUnchanged: unchanged },
    usage: result.telemetry?.usageAvailable === true
      ? { status: 'reported', ...result.telemetry.tokens }
      : { status: 'unknown', ...(result.telemetry?.partialUsage ? { partial: result.telemetry.partialUsage } : {}) },
    reportedModels: result.telemetry?.reportedModels ?? [],
    // This benign call cannot establish adversarial isolation or tool denial.
    permissionEnforcement: 'not-tested', nestedAgentEnforcement: 'not-tested',
    cancellationContract: 'not-tested', toolExecutionContract: 'not-tested',
    outputSha256: createHash('sha256').update(result.stdout).digest('hex'),
  }
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 })
  if (result.error || result.status !== 0) throw Error('Contract fixture Git operation failed')
  return result.stdout
}

export function parseOptions(args) {
  const options = new Map()
  for (const arg of args) {
    const split = arg.indexOf('=')
    const key = split < 0 ? arg : arg.slice(0, split)
    const value = split < 0 ? true : arg.slice(split + 1)
    if (!['--agent', '--model', '--live', '--out'].includes(key)) throw Error(`Unknown option: ${key}`)
    if (options.has(key)) throw Error(`Duplicate option: ${key}`)
    if (key === '--live' ? value !== true : typeof value !== 'string' || !value.trim()) throw Error(`Invalid option form: ${key}; use bare --live and --name=value for other options`)
    options.set(key, value)
  }
  return options
}

export async function main(args = process.argv.slice(2)) {
  // Validate billable intent before importing runtime modules or probing a CLI.
  const options = parseOptions(args)
  const [catalog, providers, windows, telemetry, config, fingerprint] = await Promise.all([
    import('../dist/agents/catalog.js'), import('../dist/agents/providers.js'), import('../dist/agents/windows-launch.js'),
    import('../dist/agents/telemetry.js'), import('../dist/retrofit/config.js'), import('../dist/workspace/fingerprint.js'),
  ])
  const { SUPPORTED_AGENTS } = catalog
  const { buildProviderInvocation, startProviderProcess } = providers
  const { resolveWindowsCommand } = windows
  const { parseProviderResult } = telemetry
  const { saveConfig, defaultConfig } = config
  const { workspaceFingerprint } = fingerprint
  const selected = options.has('--agent') ? String(options.get('--agent')).split(',') : [...SUPPORTED_AGENTS]
  if (selected.some(agent => !SUPPORTED_AGENTS.includes(agent)) || new Set(selected).size !== selected.length) throw Error('Select supported, distinct providers')
  if (options.has('--live') && selected.length !== 1) throw Error('Live smoke requires exactly one --agent; each invocation can incur provider charges')
  if (options.has('--model') && selected.length !== 1) throw Error('An explicit model requires one provider')
  const root = mkdtempSync(join(tmpdir(), 'yoke-provider-contract-'))
  const results = []
  try {
    git(root, ['init', '-q'])
    const schemaFile = join(root, 'result.schema.json')
    const schema = { type: 'object', properties: { schemaVersion: { type: 'integer', const: 1 }, nonce: { type: 'string' } }, required: ['schemaVersion', 'nonce'], additionalProperties: false }
    writeFileSync(schemaFile, JSON.stringify(schema))
    // Even a smoke has a durable admission record outside the disposable cwd.
    saveConfig(root, { ...defaultConfig('contract-smoke'), executionBudget: { id: randomUUID(), maxCalls: 1, maxMinutes: 2, maxPromptBytes: 4096 } })
    for (const agent of selected) {
      const command = process.platform === 'win32' ? resolveWindowsCommand(agent, ['--version']) : { command: agent, args: ['--version'] }
      const version = spawnSync(command.command, command.args, { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 16384, shell: false, windowsHide: true })
      const available = !version.error && version.status === 0
      const item = { agent, availability: available ? 'available' : 'unavailable',
        version: available ? (version.stdout || version.stderr).replace(/[\x00-\x1f\x7f]/gu, ' ').trim().slice(0, 320) || null : null,
        modelRequested: options.get('--model') ?? null, contract: { status: 'not-run' } }
      if (available && options.has('--live')) {
        const nonce = randomUUID()
        const prompt = `Return exactly this JSON object and nothing else: ${JSON.stringify({ schemaVersion: 1, nonce })}. Do not use tools, write files, delegate, or start another agent.`
        const output = agent === 'codex' ? { schemaFile } : agent === 'claude' && process.platform !== 'win32' ? { jsonSchema: schema } : {}
        const selection = { nativeMultiAgent: false, ...(options.has('--model') ? { model: String(options.get('--model')) } : {}) }
        const invocation = buildProviderInvocation(agent, prompt, root, 'read-only', selection, output)
        invocation.execution = { root, role: 'provider-contract-smoke', provider: agent }
        const before = workspaceFingerprint(root)
        const result = await startProviderProcess(agent, invocation, { totalTimeoutMs: 60000, idleTimeoutMs: 30000, progressTimeoutMs: 30000, outputLimitBytes: 1024 * 1024 }).completion
        const after = workspaceFingerprint(root)
        item.contract = assessContract(parseProviderResult(agent, result.stdout), result, nonce, before === after)
      }
      results.push(item)
    }
    const report = { schemaVersion: 1, contractVersion: CONTRACT_VERSION, measuredAt: new Date().toISOString(),
      node: process.version, platform: process.platform, mode: options.has('--live') ? 'live-single-provider' : 'availability-only', results,
      limits: ['Availability probes do not validate CLI contracts.', 'A live pass validates only benign structured output on the recorded version/model.',
        'No permission-denial, native delegation, real tool execution, or cancellation claim follows from this smoke.', 'Unknown usage is retained as unknown; no token or price estimate is substituted.'] }
    const json = JSON.stringify(report, null, 2) + '\n'
    if (options.has('--out')) {
      const path = resolve(String(options.get('--out')))
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, json)
    }
    process.stdout.write(json)
    return options.has('--live') && results.some(row => row.contract.status !== 'passed') ? 2 : 0
  } finally { rmSync(root, { recursive: true, force: true }) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code }).catch(error => { console.error(error.message); process.exitCode = 2 })
}
