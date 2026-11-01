import type { AuditFinding } from './types.js'

export function dependencyAuditCommand(files: string[]): [string, string[]] | null {
  if (files.includes('package-lock.json')) return ['npm', ['audit', '--json']]
  if (files.includes('pnpm-lock.yaml')) return ['pnpm', ['audit', '--json']]
  // Yarn versions use distinct NDJSON/bulk-advisory contracts. Do not route
  // them into npm's parser or accept generic {} as evidence of a clean audit.
  if (files.includes('Cargo.lock')) return ['cargo', ['audit', '--json']]
  return null
}

export function dependencyAuditCoverage(files: string[]): { scannedLockfiles: string[]; unscannedLockfiles: string[] } {
  const selected = ['package-lock.json', 'pnpm-lock.yaml', 'Cargo.lock'].find(name => files.includes(name))
  const knownLocks = /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum|uv\.lock|poetry\.lock|Pipfile\.lock|Gemfile\.lock|composer\.lock|bun\.lockb?|mix\.lock)$/u
  return { scannedLockfiles: selected ? [selected] : [], unscannedLockfiles: files.filter(file => knownLocks.test(file) && file !== selected) }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A completed audit is evidence; a parseable error object is not. */
export function parseDependencyAudit(output: string): AuditFinding[] {
  let value: unknown
  try { value = JSON.parse(output) } catch { throw new Error('Dependency audit returned invalid or missing JSON') }
  if (!object(value) || value.error !== undefined) throw new Error('Dependency audit failed or returned an unsupported report')
  const metadata = value.metadata
  if (object(metadata) && object(metadata.vulnerabilities)) {
    const counts = metadata.vulnerabilities
    if (!['high', 'critical'].every(level => Number.isSafeInteger(counts[level]) && Number(counts[level]) >= 0)) {
      throw new Error('Dependency audit report is missing valid high/critical counts')
    }
    const findings: AuditFinding[] = []
    for (const [level, severity] of [['info', 'info'], ['low', 'low'], ['moderate', 'medium'], ['high', 'high'], ['critical', 'critical']] as const) {
      const count = counts[level]
      if (count === undefined) continue
      if (!Number.isSafeInteger(count) || Number(count) < 0) throw new Error(`Dependency audit report has an invalid ${level} count`)
      if (Number(count) > 0) findings.push({ ruleId: `dependencies.${level}`, severity, message: `${count} ${level} dependency vulnerabilities`, file: 'package lock' })
    }
    return findings
  }
  // cargo-audit reports advisories without requiring a CVSS score for each one.
  const vulnerabilities = value.vulnerabilities
  if (object(vulnerabilities) && typeof vulnerabilities.found === 'boolean' && Number.isSafeInteger(vulnerabilities.count)
    && Number(vulnerabilities.count) >= 0 && Array.isArray(vulnerabilities.list)
    && vulnerabilities.list.length === vulnerabilities.count && vulnerabilities.found === (Number(vulnerabilities.count) > 0)) {
    return vulnerabilities.found ? [{ ruleId: 'dependencies.rust-advisory', severity: 'high', message: `${vulnerabilities.count} Rust dependency advisories; inspect cargo audit for details`, file: 'Cargo.lock' }] : []
  }
  throw new Error('Dependency audit returned an unsupported or incomplete report')
}
