import type { AuditFinding } from './types.js'

const SENSITIVE = /(^|\/)(\.github\/workflows|auth|permissions?|secrets?|infra|terraform)(\/|\.|$)/i

export function scanSensitiveChanges(files: string[]): AuditFinding[] {
  return [...new Set(files)].filter(file => SENSITIVE.test(file.replace(/\\/g, '/'))).sort().map(file => ({
    ruleId: 'changes.sensitive-path', severity: 'medium', message: 'Security-sensitive path changed; review explicitly', file,
  }))
}
