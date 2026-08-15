import { execFileSync } from 'node:child_process'

export type ProcessIdentityQuery = (command: string, args: readonly string[], options?: { readonly env?: NodeJS.ProcessEnv }) => string

const queryProcessIdentity: ProcessIdentityQuery = (command, args, options) => execFileSync(command, args, { stdio: 'pipe', ...options }).toString()

export function processIncarnation(pid: number, platform: NodeJS.Platform = process.platform, query: ProcessIdentityQuery = queryProcessIdentity): string | undefined {
  try {
    if (platform === 'win32') {
      const output = query('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_Process -Filter "ProcessId = $env:YOKE_PROCESS_PID").CreationDate'], { env: { ...process.env, YOKE_PROCESS_PID: String(pid) } }).trim()
      return output ? `win32:${output}` : undefined
    }
    const output = query('ps', ['-o', 'lstart=', '-p', String(pid)]).trim()
    return output ? `posix:${output}` : undefined
  } catch {
    return undefined
  }
}
