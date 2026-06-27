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
