import { execFileSync } from 'node:child_process'

// True only on Windows where a WSL distribution responds. Used to decide whether
// rtk can use its transparent PreToolUse hook (needs WSL) or must fall back to
// instruction mode. Never throws.
export function hasWsl(): boolean {
  if (process.platform !== 'win32') return false
  try {
    execFileSync('wsl', ['--status'], { stdio: 'pipe', timeout: 5000 })
    return true
  } catch {
    return false
  }
}
