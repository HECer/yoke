export type AuditSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical'

export interface AuditFinding {
  ruleId: string
  severity: AuditSeverity
  message: string
  file: string
  line?: number
}

export interface AuditSuppression {
  ruleId: string
  file?: string
  reason: string
  expires?: string
}

export interface AuditResult {
  code: 0 | 1 | 2
  findings: AuditFinding[]
  error?: string
}
