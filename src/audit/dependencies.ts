import type { AuditFinding } from './types.js'

export function dependencyAuditCommand(files: string[]): [string, string[]] | null {
  if (files.includes('package-lock.json')) return ['npm', ['audit', '--json']]
  if (files.includes('pnpm-lock.yaml')) return ['pnpm', ['audit', '--json']]
  if (files.includes('yarn.lock')) return ['yarn', ['npm', 'audit', '--json']]
  return null
}

export function parseDependencyAudit(output: string): AuditFinding[] {
  let value: any
  try { value = JSON.parse(output) } catch { return [{ ruleId: 'dependencies.audit-error', severity: 'high', message: 'Dependency audit returned invalid JSON', file: 'package manifest' }] }
  const vulnerabilities = value?.metadata?.vulnerabilities
  const count = Number(vulnerabilities?.high ?? 0) + Number(vulnerabilities?.critical ?? 0)
  return count > 0 ? [{ ruleId: 'dependencies.high', severity: 'high', message: `${count} high/critical dependency vulnerabilities`, file: 'package lock' }] : []
}
