import type { AuditFinding } from './types.js'

const RULES = [
  { ruleId: 'secret.github-token', severity: 'critical' as const, pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g, message: 'GitHub token detected' },
  { ruleId: 'secret.aws-access-key', severity: 'critical' as const, pattern: /\bAKIA[0-9A-Z]{16}\b/g, message: 'AWS access key detected' },
  { ruleId: 'secret.private-key', severity: 'critical' as const, pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, message: 'Private key material detected' },
]

export function scanSecrets(file: string, content: string): AuditFinding[] {
  const findings: AuditFinding[] = []
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0
    for (const match of content.matchAll(rule.pattern)) {
      const line = content.slice(0, match.index).split(/\r?\n/).length
      findings.push({ ruleId: rule.ruleId, severity: rule.severity, message: rule.message, file, line })
    }
  }
  return findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || a.ruleId.localeCompare(b.ruleId))
}
