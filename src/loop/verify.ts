import { execSync } from 'node:child_process'

export interface VerifyResult {
  passed: boolean
  summary: string
}

export type Verifier = (targetDir: string) => VerifyResult

// Runs a shell command in the target dir; passed = exit 0. execSync goes through the
// shell, so `npm test` resolves npm.cmd on Windows. Output is captured (not streamed).
export function commandVerifier(command: string): Verifier {
  return (targetDir: string): VerifyResult => {
    try {
      execSync(command, { cwd: targetDir, stdio: 'pipe', timeout: 600_000 })
      return { passed: true, summary: `verify passed: ${command}` }
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer; signal?: string }
      const out = (err.stderr?.toString('utf8') ?? '') || (err.stdout?.toString('utf8') ?? '')
      const tail = out.trim().split('\n').slice(-5).join('\n')
      const suffix = err.signal === 'SIGTERM' ? ' (timed out)' : (tail ? `\n${tail}` : '')
      return { passed: false, summary: `verify failed: ${command}${suffix}` }
    }
  }
}

/** Execute the proof commands attached to one acceptance criterion. */
export function commandsVerifier(commands: string[]): Verifier {
  return (targetDir: string): VerifyResult => {
    for (const command of commands) {
      const result = commandVerifier(command)(targetDir)
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
