import { readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, resolve, win32 } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import type { AgentInvocation } from './types.js'
import { prepareChildEnvironment } from './child-environment.js'
import { observedError } from '../observability/failure.js'

const file = (path: string) => { try { return statSync(path).isFile() } catch { return false } }
const pathValue = (env: NodeJS.ProcessEnv) => env[Object.keys(env).find(k => k.toLowerCase() === 'path') ?? 'PATH'] ?? ''

/** Resolve npm launchers without cmd.exe argument concatenation. */
export function resolveWindowsCommand(command: string, args: readonly string[], env = process.env): { command: string; args: string[] } {
  if (command === 'node' || command === process.execPath) return { command: process.execPath, args: [...args] }
  const candidates = isAbsolute(command) || /[\\/]/u.test(command) ? [command]
    : pathValue(env).split(';').filter(Boolean).flatMap(dir => extname(command) ? [join(dir, command)] : ['.exe', '.com', '.cmd', '.bat'].map(ext => join(dir, command + ext)))
  const found = candidates.find(file)
  if (!found) throw observedError(`Provider executable unavailable: ${command}`, 'missing-executable', 'not-started')
  if (/\.(exe|com)$/iu.test(found)) return { command: found, args: [...args] }
  const script = readFileSync(found, 'utf8')
  const entry = script.match(/"%dp0%[\\/]([^"\r\n]+\.(?:m?js|cjs))"/iu)?.[1]
  if (!entry) throw observedError('Unsupported Windows batch launcher; use a native executable or an npm-generated CLI launcher', 'preflight', 'not-started')
  const target = resolve(dirname(found), ...entry.split(/[\\/]/u))
  if (!file(target)) throw observedError('Provider npm entry point is missing', 'missing-executable', 'not-started')
  const localNode = join(dirname(found), 'node.exe')
  return { command: file(localNode) ? localNode : process.execPath, args: [target, ...args] }
}

export function inaccessibleStoreShell(path: string): boolean {
  const bad = (p: string) => /[\\/]WindowsApps[\\/](?:Microsoft\.PowerShell[^\\/]*[\\/]|(?:pwsh|powershell)\.exe$)/iu.test(p)
  if (bad(path)) return true
  try { return bad(realpathSync(path)) } catch { return false }
}

export function windowsShellEnvironment(env: NodeJS.ProcessEnv = process.env): { env: NodeJS.ProcessEnv; shell: string } {
  // Change only this provider's PATH. Never change machine/user configuration or permissions.
  const paths = pathValue(env).split(';').filter(Boolean).filter(dir =>
    !['pwsh.exe', 'powershell.exe'].some(name => inaccessibleStoreShell(join(dir, name))))
  const nativePwsh = join(env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe')
  const systemShell = join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const shell = [...paths.map(p => join(p, 'pwsh.exe')), nativePwsh, ...paths.map(p => join(p, 'powershell.exe')), systemShell].find(p => file(p) && !inaccessibleStoreShell(p))
  if (!shell) throw observedError('No native PowerShell available for sandbox preflight', 'preflight', 'not-started')
  const next = { ...env }
  for (const key of Object.keys(next)) if (key.toLowerCase() === 'path') delete next[key]
  const shellDir = dirname(shell)
  next.PATH = [shellDir, ...paths.filter(path => win32.normalize(path).toLowerCase() !== win32.normalize(shellDir).toLowerCase())].join(';')
  return { env: next, shell }
}

/** Installed releases need the compiled watchdog; source checkouts also require tsx. */
export function windowsWatchdogArgs(moduleUrl = import.meta.url): string[] {
  const compiled = fileURLToPath(new URL('../loop/watchdog.js', moduleUrl))
  if (file(compiled)) return [compiled]
  const source = fileURLToPath(new URL('../loop/watchdog.ts', moduleUrl))
  if (!file(source)) throw observedError('Provider watchdog entry point is missing', 'missing-executable', 'not-started')
  try {
    return ['--import', pathToFileURL(createRequire(moduleUrl).resolve('tsx')).href, source]
  } catch {
    throw observedError('Provider source watchdog requires the unavailable tsx entry point', 'missing-executable', 'not-started')
  }
}

/** Model-free probe under the same Codex permission profile and isolated cwd. */
export function prepareWindowsInvocation(inv: AgentInvocation, env = process.env): { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; shell?: string } {
  const child = prepareChildEnvironment(inv.cwd, env, 'win32')
  if (inv.command !== 'codex' || !inv.args.includes('exec') || inv.args.includes('--dangerously-bypass-approvals-and-sandbox')) return { ...resolveWindowsCommand(inv.command, inv.args, child.env), ...child }
  const prepared = windowsShellEnvironment(child.env)
  const readOnly = inv.args.includes('read-only')
  const config = ['--config', `shell_environment_policy.set.PATH=${JSON.stringify(prepared.env.PATH)}`]
  const probe = resolveWindowsCommand('codex', ['sandbox', '-P', readOnly ? ':read-only' : ':workspace', '-C', child.cwd, ...config, '--', prepared.shell, '-NoProfile', '-NonInteractive', '-Command', 'Write-Output YOKE_SHELL_OK'], prepared.env)
  const watchdog = windowsWatchdogArgs()
  // The inner watchdog owns the native process tree. Killing only an npm wrapper
  // on spawnSync timeout could otherwise leave the sandbox helper behind.
  const result = spawnSync(process.execPath, [...watchdog, '--idle-ms=30000', '--total-ms=30000', '--', probe.command, ...probe.args], { cwd: child.cwd, env: prepared.env, shell: false, windowsHide: true, encoding: 'utf8', timeout: 90_000, maxBuffer: 64 * 1024 })
  if (result.status !== 0 || !result.stdout?.includes('YOKE_SHELL_OK')) {
    const signature = /CreateProcessAsUserW failed:\s*-?\d+/u.exec(result.stderr ?? '')?.[0]
    throw observedError(`Codex sandbox preflight failed (${signature ?? (result.error as NodeJS.ErrnoException | undefined)?.code ?? result.status ?? 'no completion'}); no model started. Check native PowerShell and Codex sandbox setup.`, 'preflight', 'not-started')
  }
  return { ...resolveWindowsCommand(inv.command, [...inv.args, ...config], prepared.env), cwd: child.cwd, ...prepared }
}
