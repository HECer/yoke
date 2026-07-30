import { describe, expect, it } from 'vitest'
import { buildProviderInvocation } from '../../src/agents/providers.js'

describe('provider invocations', () => {
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
    expect(buildProviderInvocation('codex', 'P', '/w', 'safe').args).toEqual(['exec', '--full-auto', '--json'])
    expect(buildProviderInvocation('codex', 'P', '/w', 'read-only').args).toEqual(['exec', '--sandbox', 'read-only', '--json'])
    expect(buildProviderInvocation('codex', 'P', '/w', 'unsafe').args).toContain('--dangerously-bypass-approvals-and-sandbox')
  })

  it('uses Gemini sandbox and approval profiles', () => {
    expect(buildProviderInvocation('gemini', 'P', '/w', 'safe').args).toEqual([
      '--approval-mode', 'auto_edit', '--sandbox',
    ])
    expect(buildProviderInvocation('gemini', 'P', '/w', 'read-only').args).toEqual([
      '--approval-mode', 'plan', '--sandbox',
    ])
    expect(buildProviderInvocation('gemini', 'P', '/w', 'unsafe').args).toContain('--yolo')
  })
})
