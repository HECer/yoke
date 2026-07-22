import type { Story } from './prd.js'
import { execFileSync, execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Agent } from '../retrofit/config.js'
import type { TokenUsage } from './reporter.js'
import { loadContext, formatForPrompt, contextDir } from '../context/context.js'

export interface AgentContext {
  targetDir: string
  story: Story
}

export interface AgentResult {
  success: boolean
  summary: string
  /** Cumulative token usage of this invocation (claude stream-json runners only). */
  tokens?: TokenUsage
}

export type AgentRunner = (ctx: AgentContext) => AgentResult

export function contextBlockFor(targetDir: string): string {
  return formatForPrompt(loadContext(contextDir(targetDir)))
}

// How the agent handles ambiguous acceptance criteria: 'resolve' (default —
// pick the most consistent interpretation and keep going) or 'abort' (stop the
// story via .yoke/ambiguity.md so the human decides). All questions belong in
// the planning round; a loop run never has anyone to ask.
export type AmbiguityPolicy = 'resolve' | 'abort'

export function buildClaudePrompt(story: Story, context: string, onAmbiguity: AmbiguityPolicy = 'resolve', perfCommand?: string): string {
  const criteria = story.acceptance.map(a => `- ${a}`).join('\n')
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

export function buildReviewPrompt(story: Story, context: string): string {
  const criteria = story.acceptance.map(a => `- ${a}`).join('\n')
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
    'Approve by exiting 0 ONLY if every acceptance criterion is met and the change is sound.',
    'If you find ANY blocking issue (an unmet criterion, a bug, a missing test), exit non-zero to reject.',
    'Base your verdict only on what the diff and test runs actually show — never assume unverified behavior.',
    'Do not modify files. Do not commit.',
    'Keep your verdict to a few short sentences.',
  )
  return lines.join('\n')
}

export function buildStandaloneReviewPrompt(scope: string, focus?: string): string {
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
    'Do not modify files. Do not commit.',
    'Keep your verdict to a few short sentences.',
  )
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
const AGENT_SPECS: Record<Agent, { command: string; baseArgs: string[] }> = {
  claude: { command: 'claude', baseArgs: ['-p', '--dangerously-skip-permissions'] },
  codex: { command: 'codex', baseArgs: ['exec', '--dangerously-bypass-approvals-and-sandbox'] },
  // gemini: no `-p` — current Gemini CLI (0.33+) requires a value after -p, and
  // piped (non-TTY) stdin already selects headless mode on its own.
  gemini: { command: 'gemini', baseArgs: ['--yolo'] },
}

export function agentInvocation(agent: Agent, prompt: string, cwd: string): Invocation {
  const spec = AGENT_SPECS[agent]
  return { command: spec.command, args: spec.baseArgs, input: prompt, cwd }
}

export function claudeInvocation(prompt: string, cwd: string): Invocation {
  return agentInvocation('claude', prompt, cwd)
}

// Token-reporting variant: stream-json makes claude emit per-message usage on stdout
// (--verbose is required by the CLI for stream-json in -p mode). Prompt still via stdin.
// Derived from the base spec so the headless permission-bypass flag rides along.
export function claudeStreamJsonInvocation(prompt: string, cwd: string): Invocation {
  return { command: 'claude', args: [...AGENT_SPECS.claude.baseArgs, '--output-format', 'stream-json', '--verbose'], input: prompt, cwd }
}

// Pick the runner invocation. Claude ALWAYS runs in stream-json mode: plain `-p`
// prints nothing until the run finishes, so the idle watchdog saw a healthy
// long story as a dead process and killed it at exactly the idle window — and
// the user saw dead air the whole time. stream-json emits per-message output,
// which doubles as liveness. Token usage rides along for free. Other agents
// keep their plain invocation (no machine-readable stream to gain).
export function runnerInvocation(agent: Agent, prompt: string, cwd: string, _tokenReport = false): Invocation {
  if (agent === 'claude') return claudeStreamJsonInvocation(prompt, cwd)
  return agentInvocation(agent, prompt, cwd)
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

function watchdogPath(): string {
  // runner.js and watchdog.js sit side by side (dist/loop/ at runtime, src/loop/ under tsx)
  return fileURLToPath(new URL('./watchdog.js', import.meta.url))
}

// When idleTimeoutMs > 0, run the agent THROUGH the watchdog so a silent hang is
// killed after idleTimeoutMs of no output. The prompt still flows via stdin.
// If the run dir has a .yoke dir, the watchdog also records its pids in
// .yoke/runner.pid so `yoke loop cleanup` can reap orphans PROJECT-SCOPED —
// killing by process-name/command-line pattern takes down other projects'
// runners too. (Plain repos, e.g. `yoke review` outside a yoke project, get
// no pid file rather than a littered .yoke dir.)
export function buildWatchdogInvocation(inv: Invocation, idleTimeoutMs: number): Invocation {
  if (idleTimeoutMs <= 0) return inv
  const yokeDir = join(inv.cwd, '.yoke')
  const pidArgs = existsSync(yokeDir) ? [`--pid-file=${join(yokeDir, 'runner.pid')}`] : []
  return {
    command: 'node',
    args: [watchdogPath(), `--idle-ms=${idleTimeoutMs}`, ...pidArgs, '--', inv.command, ...inv.args],
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
  if (process.platform === 'win32') {
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
  return process.platform === 'win32'
    ? execSync(win32CommandString(inv.command, inv.args), opts)
    : execFileSync(inv.command, inv.args, opts)
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

export interface RunnerOpts {
  /** Run claude in stream-json mode and report cumulative token usage on the AgentResult. */
  tokenReport?: boolean
  /** Ambiguous-criteria handling for the implementer prompt (default 'resolve': never stop). */
  onAmbiguity?: AmbiguityPolicy
  /** Performance budget command (config perf.command) — surfaced to the implementer so it never regresses the budget blind. */
  perfCommand?: string
  /** Test seam for the normal (inherit-stdio) execution path. */
  exec?: (inv: Invocation) => void
  /** Test seam for the captured (piped-stdout) execution path. */
  execCapture?: (inv: Invocation) => string
}

export function makeRunner(agent: Agent, idleTimeoutMs = 0, opts: RunnerOpts = {}): AgentRunner {
  // Claude always streams (see runnerInvocation) — capture the stream so tokens are
  // always reported; other agents keep inherit stdio. opts.tokenReport is now
  // redundant for claude and meaningless elsewhere; kept for caller compatibility.
  const captureTokens = agent === 'claude'
  return (ctx: AgentContext): AgentResult => {
    const base = runnerInvocation(agent, buildClaudePrompt(ctx.story, contextBlockFor(ctx.targetDir), opts.onAmbiguity, opts.perfCommand), ctx.targetDir, captureTokens)
    const inv = buildWatchdogInvocation(base, idleTimeoutMs)
    if (captureTokens) {
      const capture = opts.execCapture ?? runCliCapture
      try {
        const out = capture(inv)
        return { success: true, summary: `${agent} implemented ${ctx.story.id}`, tokens: parseClaudeStreamUsage(out.split(/\r?\n/)) }
      } catch (e) {
        // Salvage usage from whatever the agent streamed before dying — those tokens were spent.
        const partial = (e as { stdout?: unknown }).stdout
        const tokens = partial == null ? undefined : parseClaudeStreamUsage(String(partial).split(/\r?\n/))
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

export function makeReviewRunner(agent: Agent, idleTimeoutMs = 0): AgentRunner {
  return (ctx: AgentContext): AgentResult => {
    const base = agentInvocation(agent, buildReviewPrompt(ctx.story, contextBlockFor(ctx.targetDir)), ctx.targetDir)
    const inv = buildWatchdogInvocation(base, idleTimeoutMs)
    try {
      runCli(inv)
      return { success: true, summary: `${agent} approved ${ctx.story.id}` }
    } catch (e) {
      return { success: false, summary: `${agent} rejected ${ctx.story.id}: ${(e as Error).message}` }
    }
  }
}

// Probe whether the agent's CLI is on PATH (so the loop can refuse upfront with a
// clear message instead of failing mid-run with spawn ENOENT). Never throws.
export function isAgentAvailable(agent: Agent): boolean {
  return probeVersion(AGENT_SPECS[agent].command)
}
