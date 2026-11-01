import { describe, expect, it } from 'vitest'
import { parseDependencyAudit, dependencyAuditCommand, dependencyAuditCoverage } from '../../src/audit/dependencies.js'
import { runAudit } from '../../src/audit/command.js'

describe('dependency audit evidence', () => {
  it.each(['{}', '{"error":{"code":"ENOTFOUND"}}', 'null', '[]', '', '{"metadata":{"vulnerabilities":{"high":0}}}', '{"metadata":{"vulnerabilities":{"high":"0","critical":0}}}'])('does not turn unavailable/malformed output into a clean result: %s', output => {
    expect(() => parseDependencyAudit(output)).toThrow(/Dependency audit/)
    expect(runAudit('.', { files: () => [], changed: () => [], dependency: () => parseDependencyAudit(output) })).toMatchObject({ code: 2, dependencyStatus: 'unavailable' })
  })

  it('reports lower-severity findings without treating them as a high-severity gate failure', () => {
    const output = JSON.stringify({ metadata: { vulnerabilities: { moderate: 2, high: 0, critical: 0 } } })
    expect(runAudit('.', { files: () => [], changed: () => [], dependency: () => parseDependencyAudit(output) })).toMatchObject({ code: 0, dependencyStatus: 'findings', findings: [{ severity: 'medium' }] })
    expect(parseDependencyAudit('{"metadata":{"vulnerabilities":{"high":0,"critical":0}}}')).toEqual([])
  })

  it('explicitly reports unsupported coverage', () => {
    expect(runAudit('.', { files: () => ['go.mod'], changed: () => [], read: () => '' })).toMatchObject({ code: 0, dependencyStatus: 'unsupported', findings: [{ ruleId: 'dependencies.unsupported' }] })
  })

  it('does not send Yarn reports to the npm parser or silently claim mixed-lockfile coverage', () => {
    expect(dependencyAuditCommand(['yarn.lock'])).toBeNull()
    expect(runAudit('.', { files: () => ['yarn.lock'], changed: () => [], read: () => '' })).toMatchObject({ dependencyStatus: 'unsupported', dependencyCoverage: { scannedLockfiles: [], unscannedLockfiles: ['yarn.lock'] } })
    expect(dependencyAuditCoverage(['package-lock.json', 'Cargo.lock', 'nested/yarn.lock'])).toEqual({ scannedLockfiles: ['package-lock.json'], unscannedLockfiles: ['Cargo.lock', 'nested/yarn.lock'] })
  })

  it('recognizes cargo-audit reports and rejects inconsistent counts', () => {
    expect(dependencyAuditCommand(['Cargo.lock'])).toEqual(['cargo', ['audit', '--json']])
    expect(parseDependencyAudit('{"vulnerabilities":{"found":false,"count":0,"list":[]}}')).toEqual([])
    expect(parseDependencyAudit('{"vulnerabilities":{"found":true,"count":1,"list":[{}]}}')[0].severity).toBe('high')
    expect(() => parseDependencyAudit('{"vulnerabilities":{"found":false,"count":1,"list":[]}}')).toThrow()
  })
})
