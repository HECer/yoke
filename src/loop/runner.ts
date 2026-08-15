import { isAcceptanceCriterion, type Story } from './prd.js'
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Agent, DecisionPolicy } from '../retrofit/config.js'
import type { TokenUsage } from './reporter.js'
import { loadContext, formatForPrompt, contextDir } from '../context/context.js'
import { buildProviderInvocation, startProviderProcess } from '../agents/providers.js'
import { parseProviderResult, parseProviderTelemetry } from '../agents/telemetry.js'
import type { ModelSelection, PermissionProfile } from '../agents/types.js'
import type { ProviderProcessHandle, ProviderProcessOptions } from '../agents/process.js'
import { formatReviewContract, formatReviewStdoutContract, parseReviewVerdict, type ReviewVerdict } from '../review/verdict.js'
import type { ReviewOutcome } from '../quality/repair.js'

export interface AgentContext {
  targetDir: string
  story: Story
}

export interface AgentResult {
  success: boolean
  summary: string
  reviewOutcome?: ReviewOutcome
  /** Cumulative token usage of this invocation (agents running in JSON mode only). */
  tokens?: TokenUsage
  /** Adaptive runners defer capability learning until Yoke's independent gates decide. */
  routing?: { recordOutcome: (verified: boolean) => void }
}

export type AgentRunner = (ctx: AgentContext) => AgentResult

export function contextBlockFor(targetDir: string): string {
  return formatForPrompt(loadContext(contextDir(targetDir)))
}

// How the agent handles ambiguous acceptance criteria: 'resolve' (default —
// pick the most consistent interpretation and keep going) or 'abort' (stop the
// story via .yoke/ambiguity.md so the human decides). All questions belong in
// the planning round; a loop run never has anyone to ask.
export type AmbiguityPolicy = 'resolve' | 'abort' | DecisionPolicy

function formatAcceptance(story: Story): string {
  return story.acceptance.map(criterion => {
    if (!isAcceptanceCriterion(criterion)) return `- ${criterion}`
    return `- [${criterion.id}] ${criterion.text}\n  Proof: ${criterion.verify.join(' && ')}`
  }).join('\n')
}

export function buildClaudePrompt(story: Story, context: string, onAmbiguity: AmbiguityPolicy = 'resolve', perfCommand?: string): string {
  const criteria = formatAcceptance(story)
  const lines = [
    'You are an autonomous coding agent running inside the Yoke loop.',
    'Implement ONLY this story and nothing else. Follow test-driven development.',
  ]
  if (context) lines.push('', context)
  lines.push(
    '',
    `Story ${story.id}: ${story.title}`,
    'Acceptance criteria (Definition of Done):',
    criteria,
    '',
    "When done, ensure the project's full test suite passes.",
    'Do NOT commit — the loop commits on your behalf after verifying.',
    '',
    'Working rules:',
    '- Add nothing beyond what the story requires: no extra features, abstractions, comments, or defensive code for cases that cannot happen.',
    '- Do not create summary, plan, or analysis documents — only files the story itself needs.',
    '- If a check fails, fix the root cause; never bypass it (e.g. --no-verify) or pass by weakening tests.',
    '- Report the outcome faithfully: if a criterion is unmet or tests fail, say so plainly instead of claiming success.',
    '- Never ask questions or wait for input — you run unattended and nobody can answer.',
    onAmbiguity === 'abort'
      ? '- If an acceptance criterion is genuinely undecidable, do NOT guess: write the open question(s) to .yoke/ambiguity.md, change nothing else, and stop.'
      : onAmbiguity === 'critical'
        ? [
            '- Resolve routine ambiguity yourself using the plan, acceptance criteria, existing code, and established project conventions.',
            '- Stop only for a high-impact decision involving public architecture, security or privacy posture, destructive data migration or data loss, material external cost, legal/compliance exposure, or another irreversible choice.',
            '- For such a critical decision, change nothing else. Write .yoke/decision-request.yaml with exactly: version: 1, storyId, question, reason, 2-4 options ({id, label, optional tradeoff}), and recommended (an option id). Then stop.',
          ].join('\n')
      : '- If an acceptance criterion is ambiguous, resolve it yourself in the way most consistent with the other criteria and the existing code, and state your interpretation in your final message.',
  )
  if (perfCommand) {
    lines.push(
      `- This project enforces a performance budget: \`${perfCommand}\` must exit 0 or the story is blocked. Keep hot paths efficient, and never simplify away an existing optimization without re-running that benchmark.`,
    )
  }
  lines.push(
    '- Keep your final message to a few short sentences: what changed and what you verified.',
  )
  return lines.join('\n')
}

export function buildReviewPrompt(story: Story, context: string, verdictPath?: string, provider?: Agent): string {
  const criteria = formatAcceptance(story)
  const lines = [
    'You are an independent reviewer inside the Yoke loop. You did NOT implement this change.',
    'Review the current uncommitted working-tree changes against the story below.',
  ]
  if (context) lines.push('', context)
  lines.push(
    '',
    `Story ${story.id}: ${story.title}`,
    'Acceptance criteria:',
    criteria,
    '',
    'Approve ONLY if every acceptance criterion is met and the change is sound.',
    'If you find ANY blocking issue (an unmet criterion, a bug, a missing test), reject.',
    'Base your verdict only on what the diff and test runs actually show — never assume unverified behavior.',
    verdictPath
      ? 'Do not modify project source, tests, configuration, or generated artifacts. The verdict file named below is the only permitted write. Do not commit.'
      : 'Do not modify files. Do not commit.',
    'Keep your verdict to a few short sentences.',
  )
  lines.push('', verdictPath ? formatReviewContract(verdictPath, provider) : formatReviewStdoutContract(provider ?? 'claude'))
  return lines.join('\n')
}

export function buildStandaloneReviewPrompt(scope: string, focus?: string, verdictPath?: string, provider?: Agent): string {
  const lines = [
    'You are an independent reviewer. You did NOT write this change.',
    `Review ${scope}. Run git yourself to see the diff (e.g. \`git diff\`, or \`git diff <base>..HEAD\`).`,
    'Judge it for correctness, unmet intent, missing tests, and obvious bug or security risks.',
  ]
  if (focus) lines.push(`Pay particular attention to: ${focus}.`)
  lines.push(
    '',
    'Approve by exiting 0 ONLY if the change is sound and complete.',
    'If you find ANY blocking issue, exit non-zero to reject and explain what is wrong.',
    'Base your verdict only on what the diff and test runs actually show — never assume unverified behavior.',
    verdictPath
      ? 'Do not modify project source, tests, configuration, or generated artifacts. The verdict file named below is the only permitted write. Do not commit.'
      : 'Do not modify files. Do not commit.',
    'Keep your verdict to a few short sentences.',
  )
  lines.push('', verdictPath ? formatReviewContract(verdictPath, provider) : formatReviewStdoutContract(provider ?? 'claude'))
  return lines.join('\n')
}

export interface Invocation {
  command: string
  args: string[]
  input: string
  cwd: string
}

// Headless agents must run non-interactively: with plain `-p` the CLI denies
// every file-write/permission prompt, so the implementer "runs" (exit 0) but
// produces NOTHING. The loop then sees a clean tree + green pre-existing tests
// and falsely marks the story done. Granting autonomous permissions makes the
// implementer actually able to write files and run the verify command.
// (The loop is opt-in and scoped to the target project dir.)
export function agentInvocation(agent: Agent, prompt: string, cwd: string, permissions: PermissionProfile = 'safe', selection: ModelSelection = {}): Invocation {
  return buildProviderInvocation(agent, prompt, cwd, permissions, selection)
}

export function claudeInvocation(prompt: string, cwd: string): Invocation {
  return agentInvocation('claude', prompt, cwd)
}

// Token-reporting variant: stream-json makes claude emit per-message usage on stdout
// (--verbose is required by the CLI for stream-json in -p mode). Prompt still via stdin.
// Derived from the base spec so the headless permission-bypass flag rides along.
export function claudeStreamJsonInvocation(prompt: string, cwd: string): Invocation {
  return buildProviderInvocation('claude', prompt, cwd, 'safe')
}

// Pick the runner invocation. Claude ALWAYS runs in stream-json mode: plain `-p`
// prints nothing until the run finishes, so the idle watchdog saw a healthy
// long story as a dead process and killed it at exactly the idle window — and
// the user saw dead air the whole time. stream-json emits per-message output,
// which doubles as liveness. Token usage rides along for free. Other agents
// keep their plain invocation (no machine-readable stream to gain).
export function runnerInvocation(agent: Agent, prompt: string, cwd: string, _tokenReport = false, permissions: PermissionProfile = 'safe', selection: ModelSelection = {}): Invocation {
  return buildProviderInvocation(agent, prompt, cwd, permissions, selection)
}

// Parse claude stream-json output into cumulative token usage. Defensive by design:
// non-JSON lines and unknown message shapes are ignored. The final "result" message
// carries the run's cumulative usage — prefer it (last one wins); if it is absent
// (e.g. the process died mid-run), fall back to summing assistant-message usage.
// Also tracks the model id: the "system"/"init" message and "assistant" messages both
// carry a model field — the LAST one seen across the stream wins; absent if none did.
export function parseClaudeStreamUsage(lines: string[]): TokenUsage {
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const usageOf = (v: unknown): { input: number; output: number } | null => {
    if (typeof v !== 'object' || v === null) return null
    const u = v as Record<string, unknown>
    if (u.input_tokens === undefined && u.output_tokens === undefined) return null
    return { input: num(u.input_tokens), output: num(u.output_tokens) }
  }
  const modelOf = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)
  let assistantIn = 0
  let assistantOut = 0
  let result: TokenUsage | undefined
  let model: string | undefined
  for (const line of lines) {
    let msg: unknown
    try { msg = JSON.parse(line) } catch { continue }
    if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) continue
    const m = msg as Record<string, unknown>
    if (m.type === 'result') {
      const u = usageOf(m.usage)
      if (u) result = { inputTokens: u.input, outputTokens: u.output }
    } else if (m.type === 'assistant') {
      const message = m.message as Record<string, unknown> | undefined
      const u = usageOf(message?.usage)
      if (u) { assistantIn += u.input; assistantOut += u.output }
      model = modelOf(message?.model) ?? model
    } else if (m.type === 'system' && m.subtype === 'init') {
      model = modelOf(m.model) ?? model
    }
  }
  const usage = result ?? { inputTokens: assistantIn, outputTokens: assistantOut }
  return model ? { ...usage, model } : usage
}

function watchdogArgs(): string[] {
  const compiled = fileURLToPath(new URL('./watchdog.js', import.meta.url))
  if (existsSync(compiled)) return [compiled]
  const source = fileURLToPath(new URL('./watchdog.ts', import.meta.url))
  const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href
  return ['--import', tsxLoader, source]
}

// When idleTimeoutMs > 0, run the agent THROUGH the watchdog so a silent hang is
// killed after idleTimeoutMs of no output. The prompt still flows via stdin.
// If the run dir has a .yoke dir, the watchdog also records its pids in
// .yoke/runner.pid so `yoke loop cleanup` can reap orphans PROJECT-SCOPED —
// killing by process-name/command-line pattern takes down other projects'
// runners too. (Plain repos, e.g. `yoke review` outside a yoke project, get
// no pid file rather than a littered .yoke dir.)
export function buildWatchdogInvocation(inv: Invocation, idleTimeoutMs: number, ownershipRoot: string = inv.cwd): Invocation {
  if (idleTimeoutMs <= 0) return inv
  const yokeDir = join(ownershipRoot, '.yoke')
  const pidArgs = existsSync(yokeDir) ? [`--pid-file=${join(yokeDir, 'runner.pid')}`] : []
  return {
    command: 'node',
    args: [...watchdogArgs(), `--idle-ms=${idleTimeoutMs}`, ...pidArgs, '--', inv.command, ...inv.args],
    input: inv.input,
    cwd: inv.cwd,
  }
}

// Execute a CLI invocation. On Windows the agent CLIs are `.cmd` shims that
// execFileSync cannot resolve without a shell; but passing an args array with
// shell:true triggers DEP0190. So on win32 we run a single command string via
// execSync (our args are literal flags, never user data — the prompt is piped via
// stdin), which avoids the warning. On other platforms execFileSync with no shell
// is already warning-free. Throws on a non-zero exit (caller catches).
// Build a win32 command string, quoting only args that contain whitespace.
// Existing agent flags (claude -p, codex exec) have no spaces, so they are
// unchanged; an absolute watchdog path with spaces gets quoted.
export function win32CommandString(command: string, args: string[]): string {
  const q = (s: string) => (/\s/.test(s) ? `"${s}"` : s)
  return [command, ...args].map(q).join(' ')
}

function runCli(inv: Invocation): void {
  if (process.platform === 'win32' && !/\.(?:exe|com)$/iu.test(inv.command) && inv.command !== process.execPath && inv.command !== 'node') {
    execSync(win32CommandString(inv.command, inv.args), {
      cwd: inv.cwd,
      input: inv.input,
      stdio: ['pipe', 'inherit', 'inherit'],
    })
  } else {
    execFileSync(inv.command, inv.args, {
      cwd: inv.cwd,
      input: inv.input,
      stdio: ['pipe', 'inherit', 'inherit'],
    })
  }
}

// Like runCli, but with stdout PIPED and returned (stderr stays inherited) — for
// token reporting, where the agent's stdout is a machine-readable stream-json feed.
// The watchdog wrapper forwards the child's stdout to its own, so piping still works
// through it. Throws on a non-zero exit; the error carries the partial stdout.
function runCliCapture(inv: Invocation): string {
  const opts = { cwd: inv.cwd, input: inv.input, stdio: ['pipe', 'pipe', 'inherit'] as ['pipe', 'pipe', 'inherit'], encoding: 'utf8' as const, maxBuffer: 64 * 1024 * 1024 }
  return process.platform === 'win32' && !/\.(?:exe|com)$/iu.test(inv.command) && inv.command !== process.execPath && inv.command !== 'node'
    ? execSync(win32CommandString(inv.command, inv.args), opts)
    : execFileSync(inv.command, inv.args, opts)
}

// Reviews have a machine-readable result file, so their console stream is not
// the result channel. Buffer stderr to preserve the provider's actual failure
// (authentication, sandbox startup, quota, etc.) in loop-status.json instead of
// reducing every failure to Node's generic "Command failed" message. The inner
// watchdog still observes child output live and enforces the idle timeout.
function runReviewCli(inv: Invocation): void {
  const opts = {
    cwd: inv.cwd,
    input: inv.input,
    stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
    encoding: 'utf8' as const,
    maxBuffer: 64 * 1024 * 1024,
  }
  if (process.platform === 'win32' && !/\.(?:exe|com)$/iu.test(inv.command) && inv.command !== process.execPath && inv.command !== 'node') execSync(win32CommandString(inv.command, inv.args), opts)
  else execFileSync(inv.command, inv.args, opts)
}

function processFailureSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const value = (error as { stderr?: unknown } | null)?.stderr
  const stderr = Buffer.isBuffer(value) ? value.toString('utf8') : typeof value === 'string' ? value : ''
  const clean = stderr.replace(/\x1B\[[0-?]*[ -/]*[@-~]/gu, '').trim()
  if (!clean) return message
  const tail = clean.length > 4_000 ? `…${clean.slice(-4_000)}` : clean
  return `${message}; stderr: ${tail}`
}

export interface CapturedAgentRun {
  success: boolean
  output: string
  summary: string
  tokens?: TokenUsage
}

/** Run a provider invocation with stdout captured for structured control-plane calls. */
export function runCapturedAgent(agent: Agent, inv: Invocation): CapturedAgentRun {
  try {
    const output = runCliCapture(inv)
    return { success: true, output, summary: 'exited 0', tokens: parseProviderTelemetry(agent, output.split(/\r?\n/)).tokens }
  } catch (error) {
    const partial = (error as { stdout?: unknown }).stdout
    const output = partial == null ? '' : String(partial)
    return {
      success: false,
      output,
      summary: (error as Error).message,
      tokens: output ? parseProviderTelemetry(agent, output.split(/\r?\n/)).tokens : undefined,
    }
  }
}

// Probe whether a CLI is on PATH via `<command> --version`. Same win32/other split
// as runCli to stay DEP0190-free. Never throws. Timeout is generous because some
// agent CLIs cold-start slowly (gemini needs ~6s on Windows; 5s misreported it
// as "not installed").
function probeVersion(command: string): boolean {
  try {
    if (process.platform === 'win32') {
      execSync(`${command} --version`, { stdio: 'pipe', timeout: 20000 })
    } else {
      execFileSync(command, ['--version'], { stdio: 'pipe', timeout: 20000 })
    }
    return true
  } catch {
    return false
  }
}

// Reusable one-shot invocation runner for callers outside the loop (e.g. `yoke review`).
// Mirrors makeRunner's try/catch: success=true when the CLI exits 0, false when it throws.
export function runAgent(inv: Invocation): AgentResult {
  try {
    runCli(inv)
    return { success: true, summary: 'exited 0' }
  } catch (e) {
    return { success: false, summary: (e as Error).message }
  }
}

/** Run a reviewer while retaining bounded stderr diagnostics on failure. */
export function runReviewAgent(inv: Invocation): AgentResult {
  try {
    runReviewCli(inv)
    return { success: true, summary: 'exited 0' }
  } catch (error) {
    return { success: false, summary: processFailureSummary(error) }
  }
}

export interface RunnerOpts {
  /** Run claude in stream-json mode and report cumulative token usage on the AgentResult. */
  tokenReport?: boolean
  /** Ambiguous-criteria handling for the implementer prompt (default 'resolve': never stop). */
  onAmbiguity?: AmbiguityPolicy
  /** Performance budget command (config perf.command) — surfaced to the implementer so it never regresses the budget blind. */
  perfCommand?: string
  permissions?: PermissionProfile
  /** Provider model selection for this runner. Model ids are intentionally opaque. */
  selection?: ModelSelection
  /** Test seam for the normal (inherit-stdio) execution path. */
  exec?: (inv: Invocation) => void
  /** Test seam for the captured (piped-stdout) execution path. */
  execCapture?: (inv: Invocation) => string
}

export type AsyncAgentRunner = (ctx: AgentContext) => ProviderProcessHandle

export interface AsyncRunnerOpts {
  readonly onAmbiguity?: AmbiguityPolicy
  readonly perfCommand?: string
  readonly permissions?: PermissionProfile
  readonly selection?: ModelSelection
  readonly process?: ProviderProcessOptions
}

export function makeAsyncRunner(agent: Agent, opts: AsyncRunnerOpts = {}): AsyncAgentRunner {
  return (ctx: AgentContext): ProviderProcessHandle => startProviderProcess(
    agent,
    runnerInvocation(
      agent,
      buildClaudePrompt(ctx.story, contextBlockFor(ctx.targetDir), opts.onAmbiguity, opts.perfCommand),
      ctx.targetDir,
      true,
      opts.permissions ?? 'safe',
      opts.selection,
    ),
    opts.process,
  )
}

export function makeRunner(agent: Agent, idleTimeoutMs = 0, opts: RunnerOpts = {}): AgentRunner {
  // Claude always streams (see runnerInvocation) — capture the stream so tokens are
  // always reported; other agents keep inherit stdio. opts.tokenReport is now
  // redundant for claude and meaningless elsewhere; kept for caller compatibility.
  const captureTokens = true
  return (ctx: AgentContext): AgentResult => {
    const base = runnerInvocation(agent, buildClaudePrompt(ctx.story, contextBlockFor(ctx.targetDir), opts.onAmbiguity, opts.perfCommand), ctx.targetDir, captureTokens, opts.permissions ?? 'safe', opts.selection)
    const inv = buildWatchdogInvocation(base, idleTimeoutMs)
    if (captureTokens) {
      const capture = opts.execCapture ?? runCliCapture
      try {
        const out = capture(inv)
        const telemetry = parseProviderTelemetry(agent, out.split(/\r?\n/))
        return { success: true, summary: `${agent} implemented ${ctx.story.id}`, tokens: telemetry.tokens }
      } catch (e) {
        // Salvage usage from whatever the agent streamed before dying — those tokens were spent.
        const partial = (e as { stdout?: unknown }).stdout
        const tokens = partial == null ? undefined : parseProviderTelemetry(agent, String(partial).split(/\r?\n/)).tokens
        return { success: false, summary: `${agent} failed on ${ctx.story.id}: ${(e as Error).message}`, tokens }
      }
    }
    try {
      // NOTE: the loop trusts the agent's exit code as a proxy for "it ran".
      // Independent verification happens in the loop (Baustein C2), not here.
      ;(opts.exec ?? runCli)(inv)
      return { success: true, summary: `${agent} implemented ${ctx.story.id}` }
    } catch (e) {
      return { success: false, summary: `${agent} failed on ${ctx.story.id}: ${(e as Error).message}` }
    }
  }
}

export const claudeRunner: AgentRunner = makeRunner('claude')

export function makeReviewRunner(agent: Agent, idleTimeoutMs = 0, exec?: (inv: Invocation) => void | CapturedAgentRun): AgentRunner {
  return (ctx: AgentContext): AgentResult => {
    const before = repositoryFingerprint(ctx.targetDir)
    const base = agentInvocation(agent, buildReviewPrompt(ctx.story, contextBlockFor(ctx.targetDir), undefined, agent), ctx.targetDir, 'read-only')
    const inv = buildWatchdogInvocation(base, idleTimeoutMs)
    let processFailure: string | undefined
    let actualModel: string | undefined
    let output = ''
    try {
      const result = exec?.(inv) ?? runCapturedAgent(agent, inv)
      if (!result.success) processFailure = result.summary
      actualModel = result.tokens?.model
      output = result.output
      if (!exec && !actualModel && !processFailure) processFailure = 'review provider did not report its model'
    } catch (e) {
      processFailure = processFailureSummary(e)
    }
    try {
      if (repositoryFingerprint(ctx.targetDir) !== before) throw new Error('reviewer modified the repository during a read-only review')
      const expected = { provider: agent, ...(actualModel ? { model: actualModel } : {}) }
      const verdict = parseReviewVerdict(parseProviderResult(agent, output), expected)
      if (processFailure) {
        return {
          success: false,
          summary: `review process failed: ${processFailure}; verdict: ${verdict.summary}`,
          reviewOutcome: { kind: 'infrastructure', summary: processFailure },
        }
      }
      return verdict.approved
        ? reviewResult(agent, ctx.story.id, verdict, { kind: 'approved', verdict })
        : reviewResult(agent, ctx.story.id, verdict, { kind: 'rejected', verdict })
    } catch (e) {
      const summary = `${processFailure ? `review process failed: ${processFailure}; ` : ''}${(e as Error).message}`
      return { success: false, summary, reviewOutcome: processFailure ? { kind: 'infrastructure', summary } : { kind: 'malformed', summary } }
    }
  }
}

export function repositoryFingerprint(targetDir: string): string {
  try {
    return execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: targetDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      + execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: targetDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    return ''
  }
}

function reviewResult(agent: Agent, storyId: string, verdict: ReviewVerdict, reviewOutcome: ReviewOutcome): AgentResult {
  return verdict.approved
    ? { success: true, summary: `${agent} approved ${storyId}: ${verdict.summary}`, reviewOutcome }
    : { success: false, summary: `${agent} rejected ${storyId}: ${verdict.summary}`, reviewOutcome }
}

// Probe whether the agent's CLI is on PATH (so the loop can refuse upfront with a
// clear message instead of failing mid-run with spawn ENOENT). Never throws.
export function isAgentAvailable(agent: Agent): boolean {
  return probeVersion(agent)
}
