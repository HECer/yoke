import { describe, expect, it } from 'vitest'
import { detectHostAgent, resolveRunnerAgent } from '../../src/agents/host.js'
import { defaultConfig } from '../../src/retrofit/config.js'

describe('host-aware agent selection', () => {
  it('detects Codex, Claude, and Gemini host environments', () => {
    expect(detectHostAgent({ CODEX_THREAD_ID: 'thread' })).toBe('codex')
    expect(detectHostAgent({ CLAUDECODE: '1' })).toBe('claude')
    expect(detectHostAgent({ QWEN_CLI: '1' })).toBe('qwen')
    expect(detectHostAgent({ OPENCODE_CLIENT: 'cli' })).toBe('opencode')
    expect(detectHostAgent({ KILO_CLIENT: 'cli' })).toBe('kilo')
  })

  it('prefers an active session marker over another provider home directory', () => {
    expect(detectHostAgent({ CODEX_HOME: 'C:/codex', CLAUDECODE: '1' })).toBe('claude')
    expect(detectHostAgent({ CLAUDE_CONFIG_DIR: 'C:/claude', QWEN_CLI: '1' })).toBe('qwen')
  })

  it('detects native Qwen session markers before install hints', () => {
    expect(detectHostAgent({ QWEN_CODE: '1', CODEX_HOME: '/codex' })).toBe('qwen')
    expect(detectHostAgent({ QWEN_CODE_SESSION_ID: 'session' })).toBe('qwen')
  })

  it('prefers an explicit flag, then configured runner, then current host', () => {
    const cfg = { ...defaultConfig('1.1.0'), agents: ['claude', 'codex'] as const, runner: { agent: 'codex' as const } }
    expect(resolveRunnerAgent(cfg, 'claude', 'codex')).toBe('claude')
    expect(resolveRunnerAgent(cfg, undefined, 'claude')).toBe('codex')
    expect(resolveRunnerAgent({ ...cfg, runner: undefined }, undefined, 'codex')).toBe('codex')
  })

  it('ignores an unconfigured host and falls back to the first configured agent', () => {
    const cfg = { ...defaultConfig('1.1.0'), agents: ['claude', 'qwen'] as const }
    expect(resolveRunnerAgent(cfg, undefined, 'codex')).toBe('claude')
  })

  it('uses deterministic fallbacks when no host markers or agents exist', () => {
    expect(detectHostAgent({})).toBeUndefined()
    expect(resolveRunnerAgent(defaultConfig('1.1.0'), undefined, undefined)).toBe('claude')
  })
})
