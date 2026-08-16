import { describe, expect, it } from 'vitest'
import { applySuppressions, runAudit } from '../../src/audit/command.js'
import { dependencyAuditCommand } from '../../src/audit/dependencies.js'
import { scanSensitiveChanges } from '../../src/audit/changes.js'

describe('audit command', () => {
  it('resolves dependency managers deterministically', () => {
    expect(dependencyAuditCommand(['package-lock.json'])).toEqual(['npm', ['audit', '--json']])
    expect(dependencyAuditCommand(['pnpm-lock.yaml'])).toEqual(['pnpm', ['audit', '--json']])
    expect(dependencyAuditCommand([])).toBeNull()
  })
  it('flags security-sensitive changed paths', () => {
    expect(scanSensitiveChanges(['.github/workflows/release.yml'])[0].ruleId).toBe('changes.sensitive-path')
  })
  it('requires documented, active suppressions', () => {
    const finding = { ruleId: 'x', severity: 'high' as const, message: 'x', file: 'a' }
    expect(applySuppressions([finding], [{ ruleId: 'x', file: 'a', reason: 'false positive' }])).toEqual([])
    expect(applySuppressions([finding], [{ ruleId: 'x', file: 'a', reason: '' }])).toHaveLength(1)
  })
  it('returns 1 for blocking findings and stable JSON-ready results', () => {
    const result = runAudit('.', { files: () => ['a.ts'], read: () => 'ghp_123456789012345678901234567890123456', changed: () => [], dependency: () => [] })
    expect(result.code).toBe(1)
    expect(result.findings[0]).toMatchObject({ ruleId: 'secret.github-token', severity: 'critical', file: 'a.ts', line: 1 })
  })
  it('retains a bounded custom-command failure supplied by the loop gate runner', () => {
    const result = runAudit('.', {
      files: () => [],
      changed: () => [],
      command: 'security-check',
      commandRunner: () => ({
        passed: false,
        summary: 'audit failed: security-check\nERROR vulnerable package\n[full output: .yoke/artifacts/session/audit-deadbeef.log]',
      }),
    })
    expect(result.code).toBe(1)
    expect(result.findings[0]).toMatchObject({
      ruleId: 'audit.custom-command',
      message: expect.stringContaining('audit-deadbeef.log'),
    })
  })
})
