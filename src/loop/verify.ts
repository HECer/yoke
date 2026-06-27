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
      execSync(command, { cwd: targetDir, stdio: 'pipe' })
      return { passed: true, summary: `verify passed: ${command}` }
    } catch {
      return { passed: false, summary: `verify failed: ${command}` }
    }
  }
}
