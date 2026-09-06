import { spawn } from 'node:child_process'
import { readFileSync, statSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Match Gemini's JSON-with-comments reader without interpreting executable content.
export function parseSettings(source) {
  let clean = '', quoted = false, escaped = false, line = false, block = false
  for (let i = 0; i < source.length; i++) {
    const c = source[i], next = source[i + 1]
    if (line) { if (c === '\n' || c === '\r') { line = false; clean += c } else clean += ' '; continue }
    if (block) { if (c === '*' && next === '/') { block = false; clean += '  '; i++ } else clean += c === '\n' ? '\n' : ' '; continue }
    if (quoted) { clean += c; if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue }
    if (c === '"') quoted = true
    else if (c === '/' && next === '/') { line = true; clean += '  '; i++; continue }
    else if (c === '/' && next === '*') { block = true; clean += '  '; i++; continue }
    clean += c
  }
  if (block) throw Error('Invalid settings comment')
  const value = JSON.parse(clean)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Settings must be an object')
  return value
}

export function prepareGeminiEnvironment(environment = process.env, platform = process.platform) {
  const original = environment.GEMINI_CLI_SYSTEM_SETTINGS_PATH ?? (platform === 'win32' ? 'C:\\ProgramData\\gemini-cli\\settings.json' : platform === 'darwin' ? '/Library/Application Support/GeminiCli/settings.json' : '/etc/gemini-cli/settings.json')
  let settings = {}
  try {
    if (statSync(original).size > 1048576) throw Error('Settings too large')
    settings = parseSettings(readFileSync(original, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw Error('Cannot safely preserve existing Gemini system settings')
  }
  if (settings.experimental !== undefined && (!settings.experimental || typeof settings.experimental !== 'object' || Array.isArray(settings.experimental))) throw Error('Invalid Gemini experimental settings')
  if (settings.agents !== undefined && (!settings.agents || typeof settings.agents !== 'object' || Array.isArray(settings.agents))) throw Error('Invalid Gemini agent settings')
  if (settings.agents?.overrides !== undefined && (!settings.agents.overrides || typeof settings.agents.overrides !== 'object' || Array.isArray(settings.agents.overrides))) throw Error('Invalid Gemini agent overrides')
  const dir = mkdtempSync(join(tmpdir(), 'yoke-gemini-'))
  const file = join(dir, 'settings.json')
  const cleanup = () => { try { unlinkSync(file) } catch {} try { rmdirSync(dir) } catch {} }
  const overrides = { ...settings.agents?.overrides }
  // Gemini exposes these built-ins even when experimental agents are disabled.
  for (const name of ['codebase_investigator', 'cli_help']) overrides[name] = { ...overrides[name], enabled: false }
  try { writeFileSync(file, JSON.stringify({ ...settings, experimental: { ...settings.experimental, enableAgents: false }, agents: { ...settings.agents, overrides } }), { mode: 0o600, flag: 'wx' }) }
  catch (error) { cleanup(); throw error }
  return {
    env: { ...environment, GEMINI_CLI_SYSTEM_SETTINGS_PATH: file,
      GEMINI_CLI_SYSTEM_DEFAULTS_PATH: environment.GEMINI_CLI_SYSTEM_DEFAULTS_PATH ?? join(dirname(original), 'system-defaults.json') },
    cleanup,
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  let prepared
  try {
    prepared = prepareGeminiEnvironment()
    // Keep Windows shim arguments shell-inert. Prompts use inherited stdin only.
    const args = process.argv.slice(2)
    const windows = process.platform === 'win32'
    if (windows && args.some(arg => !/^[A-Za-z0-9_./:=+-]+$/u.test(arg))) throw Error('Unsafe Gemini argument')
    const child = spawn(windows ? 'cmd.exe' : 'gemini', windows ? ['/d', '/s', '/c', ['gemini', ...args].join(' ')] : args, { stdio: 'inherit', shell: false, env: prepared.env })
    process.once('exit', prepared.cleanup)
    child.once('error', () => { process.stderr.write('Could not start the Gemini CLI\n'); process.exitCode = 127; prepared.cleanup() })
    child.once('close', code => { process.exitCode ??= code === null || code < 0 ? 1 : code; prepared.cleanup() })
  } catch {
    prepared?.cleanup()
    process.stderr.write('Could not establish bounded Gemini execution while preserving system settings\n')
    process.exitCode = 1
  }
}
