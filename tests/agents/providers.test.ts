import { describe, expect, it, vi } from 'vitest'
import { buildProviderInvocation } from '../../src/agents/providers.js'

describe('provider invocations', () => {
  it('requests Gemini streaming output in every permission profile', () => {
    for (const profile of ['safe', 'unsafe', 'read-only'] as const) {
      expect(buildProviderInvocation('gemini', 'P', '/w', profile).args.join(' ')).toContain('--output-format stream-json')
    }
  })

  it('rejects unsupported Gemini selections explicitly', () => {
    expect(() => buildProviderInvocation('gemini', 'P', '/w', 'safe', { bare: true })).toThrow(/Gemini.*bare/)
    expect(() => buildProviderInvocation('gemini', 'P', '/w', 'safe', { reasoningEffort: 'high' })).toThrow(/Gemini.*reasoning/)
    expect(() => buildProviderInvocation('gemini', 'P', '/w', 'safe', { nativeMultiAgent: true })).toThrow(/Gemini.*nativeMultiAgent/)
    expect(() => buildProviderInvocation('gemini', 'P', '/w', 'safe', { nativeMultiAgent: false })).toThrow(/Gemini.*nativeMultiAgent/)
  })
  it('uses safe, structured Claude mode without bypass flags by default', () => {
    const inv = buildProviderInvocation('claude', 'P', '/w', 'safe')
    expect(inv.args).toEqual(['-p', '--permission-mode', 'auto', '--output-format', 'stream-json', '--verbose'])
    expect(inv.args).not.toContain('--dangerously-skip-permissions')
  })

  it('supports explicit unsafe and read-only Claude profiles', () => {
    expect(buildProviderInvocation('claude', 'P', '/w', 'unsafe').args).toContain('--dangerously-skip-permissions')
    expect(buildProviderInvocation('claude', 'P', '/w', 'read-only').args).toEqual([
      '-p', '--permission-mode', 'plan', '--output-format', 'stream-json', '--verbose',
    ])
  })

  it('uses Codex workspace sandbox unless unsafe is explicit', () => {
    expect(buildProviderInvocation('codex', 'P', '/w', 'safe').args).toEqual([
      'exec', '--sandbox', 'workspace-write', '--approve-for-me', '--json',
    ])
    expect(buildProviderInvocation('codex', 'P', '/w', 'read-only').args).toEqual(['exec', '--sandbox', 'read-only', '--json'])
    expect(buildProviderInvocation('codex', 'P', '/w', 'unsafe').args).toContain('--dangerously-bypass-approvals-and-sandbox')
  })

  it('uses Gemini sandbox and approval profiles', () => {
    expect(buildProviderInvocation('gemini', 'P', '/w', 'safe').args).toEqual([
      '--approval-mode', 'auto_edit', '--sandbox', '--output-format', 'stream-json',
    ])
    expect(buildProviderInvocation('gemini', 'P', '/w', 'read-only').args).toEqual([
      '--approval-mode', 'plan', '--sandbox', '--output-format', 'stream-json',
    ])
    expect(buildProviderInvocation('gemini', 'P', '/w', 'unsafe').args).toContain('--yolo')
  })

  it('passes model selection through all providers and maps effort only where supported', () => {
    expect(buildProviderInvocation('claude', 'P', '/w', 'safe', { model: 'haiku', reasoningEffort: 'low' }).args)
      .toEqual(['-p', '--permission-mode', 'auto', '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--effort', 'low'])
    expect(buildProviderInvocation('codex', 'P', '/w', 'safe', { model: 'current-fast', reasoningEffort: 'medium' }).args)
      .toEqual(['exec', '--sandbox', 'workspace-write', '--approve-for-me', '--json', '--model', 'current-fast', '--config', 'model_reasoning_effort=medium'])
    expect(buildProviderInvocation('gemini', 'P', '/w', 'safe', { model: 'current-flash' }).args)
      .toEqual(['--approval-mode', 'auto_edit', '--sandbox', '--output-format', 'stream-json', '--model', 'current-flash'])
  })

  it('can disable Codex native subagents when Yoke owns routing', () => {
    expect(buildProviderInvocation('codex', 'P', '/w', 'safe', { nativeMultiAgent: false }).args)
      .toEqual(['exec', '--sandbox', 'workspace-write', '--approve-for-me', '--json', '--disable', 'multi_agent'])
  })

  it('supports isolated provider startup without personal plugins or MCP configuration', () => {
    expect(buildProviderInvocation('codex', 'P', '/w', 'safe', { bare: true }).args).toContain('--ignore-user-config')
    expect(buildProviderInvocation('claude', 'P', '/w', 'safe', { bare: true }).args).toContain('--bare')
  })

  it('rejects provider selectors containing Windows shell metacharacters', () => {
    expect(() => buildProviderInvocation('codex', 'P', '/w', 'safe', { model: 'safe&whoami' })).toThrow()
    expect(() => buildProviderInvocation('codex', 'P', '/w', 'safe', { reasoningEffort: 'high|whoami' })).toThrow()
  })

  it('supports native output schemas with explicit provider-specific inputs', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    try {
    expect(buildProviderInvocation('codex', 'P', '/w', 'safe', {}, { schemaFile: 'schema.json' }).args.slice(-2)).toEqual(['--output-schema', 'schema.json'])
    expect(buildProviderInvocation('claude', 'P', '/w', 'safe', {}, { jsonSchema: { type: 'object' } }).args.slice(-2)).toEqual(['--json-schema', '{"type":"object"}'])
    expect(() => buildProviderInvocation('gemini', 'P', '/w', 'safe', {}, { jsonSchema: {} })).toThrow(/structured output/)
    expect(() => buildProviderInvocation('claude', 'P', '/w', 'safe', {}, { schemaFile: 'schema.json' })).toThrow(/schema/)
    } finally { platform.mockRestore() }
  })

  it('rejects inline structured output through the Windows shell shim', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    try {
      expect(() => buildProviderInvocation('claude', 'P', '/w', 'safe', {}, { jsonSchema: { type: 'object' } })).toThrow(/Windows/)
      expect(() => buildProviderInvocation('codex', 'P', '/w', 'safe', {}, { schemaFile: 'path with spaces.json' })).toThrow(/schema/)
    } finally { platform.mockRestore() }
  })
})
