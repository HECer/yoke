import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

// True only on Windows where a WSL distribution responds.
export function hasWsl(): boolean {
  if (process.platform !== 'win32') return false
  try {
    execFileSync('wsl', ['--status'], { stdio: 'pipe', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

// True if the rtk binary is available natively or on PATH. Never throws.
export function hasRtk(): boolean {
  try {
    const cmd = process.platform === 'win32' ? 'rtk.exe' : 'rtk'
    execFileSync(cmd, ['--version'], { stdio: 'pipe', timeout: 3000 })
    return true
  } catch {
    if (process.platform === 'win32') {
      const home = process.env.USERPROFILE ?? process.env.HOME
      if (home) {
        try {
          execFileSync(join(home, '.local', 'bin', 'rtk.exe'), ['--version'], { stdio: 'pipe', timeout: 3000 })
          return true
        } catch { /* ignore */ }
      }
    }
    return false
  }
}

