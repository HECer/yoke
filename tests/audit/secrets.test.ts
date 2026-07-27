import { describe, expect, it } from 'vitest'
import { scanSecrets } from '../../src/audit/secrets.js'

describe('secret scanning', () => {
  it('detects high-confidence credentials with stable locations', () => {
    const findings = scanSecrets('config.ts', 'ok\nconst token = "ghp_123456789012345678901234567890123456"\n-----BEGIN PRIVATE KEY-----')
    expect(findings.map(f => f.ruleId)).toEqual(['secret.github-token', 'secret.private-key'])
    expect(findings[0].line).toBe(2)
  })
  it('does not flag ordinary prose', () => expect(scanSecrets('README.md', 'set your token here')).toEqual([]))
})
