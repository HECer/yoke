import { execSync } from 'node:child_process'
import { compactCommandOutput } from '../output/compact.js'
import { writeOutputArtifact } from '../output/artifact.js'
import { DEFAULT_OUTPUT_POLICY, type OutputPhase, type OutputPolicy } from '../output/types.js'

export interface VerifyResult {
  passed: boolean
  summary: string
}

export type Verifier = (targetDir: string) => VerifyResult

export interface CommandVerifierOptions {
  readonly phase?: OutputPhase
  readonly policy?: OutputPolicy
  readonly timeoutMs?: number
  readonly artifactWriter?: typeof writeOutputArtifact
}

function outputText(value: unknown): string {
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  return typeof value === 'string' ? value : ''
}

function labelledOutput(stdout: string, stderr: string): string {
  const sections: string[] = []
  if (stdout) sections.push(`=== stdout ===\n${stdout}`)
  if (stderr) sections.push(`=== stderr ===\n${stderr}`)
  return sections.join(stdout.endsWith('\n') ? '' : '\n')
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[\u0000-\u001F\u007F]/gu, ' ')
    .slice(0, 240)
}

// Runs a shell command in the target dir; passed = exit 0. execSync goes through the
// shell, so `npm test` resolves npm.cmd on Windows. Output is captured (not streamed).
export function commandVerifier(command: string, options: CommandVerifierOptions = {}): Verifier {
  return (targetDir: string): VerifyResult => {
    const phase = options.phase ?? 'verify'
    try {
      execSync(command, { cwd: targetDir, stdio: 'pipe', timeout: options.timeoutMs ?? 600_000 })
      return { passed: true, summary: `${phase} passed: ${command}` }
    } catch (e) {
      const err = e as { stdout?: Buffer | string; stderr?: Buffer | string; signal?: string; code?: string }
      const raw = labelledOutput(outputText(err.stdout), outputText(err.stderr))
      const policy = options.policy ?? DEFAULT_OUTPUT_POLICY
      const compacted = compactCommandOutput(raw, { previewBytes: policy.previewBytes })
      const timedOut = err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT'
      const parts = [`${phase} failed: ${command}${timedOut ? ' (timed out)' : ''}`]
      if (compacted.preview) parts.push(compacted.preview)
      if (compacted.originalBytes > policy.artifactThresholdBytes) {
        try {
          const artifact = (options.artifactWriter ?? writeOutputArtifact)(targetDir, raw, {
            phase,
            storyId: process.env.YOKE_STORY,
          })
          parts.push(artifact.marker)
        } catch (error) {
          parts.push(`[artifact unavailable: ${errorMessage(error)}]`)
        }
      }
      return { passed: false, summary: parts.join('\n') }
    }
  }
}

/** Execute the proof commands attached to one acceptance criterion. */
export function commandsVerifier(commands: string[], options: CommandVerifierOptions = {}): Verifier {
  return (targetDir: string): VerifyResult => {
    for (const command of commands) {
      const result = commandVerifier(command, options)(targetDir)
      if (!result.passed) return result
    }
    return { passed: true, summary: `${commands.length} criterion command${commands.length === 1 ? '' : 's'} passed` }
  }
}

// Re-run a failing verifier up to `retries` times; the first pass wins. Lets a
// transient flake (e.g. a load-induced async timeout) self-heal while a real
// failure still fails (it stays red across every attempt).
export function retryingVerifier(inner: Verifier, retries: number): Verifier {
  return (targetDir: string): VerifyResult => {
    let last = inner(targetDir)
    let attempt = 0
    while (!last.passed && attempt < retries) {
      attempt++
      last = inner(targetDir)
    }
    if (last.passed && attempt > 0) {
      return { passed: true, summary: `${last.summary} (passed on retry ${attempt})` }
    }
    if (!last.passed && attempt > 0) {
      return { passed: false, summary: `${last.summary} (still failing after ${attempt} retr${attempt === 1 ? 'y' : 'ies'})` }
    }
    return last
  }
}
