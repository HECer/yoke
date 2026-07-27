import { execFileSync, execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dependencyAuditCommand, parseDependencyAudit } from './dependencies.js'
import { scanSensitiveChanges } from './changes.js'
import { scanSecrets } from './secrets.js'
import type { AuditFinding, AuditResult, AuditSuppression } from './types.js'

export interface AuditOptions {
  json?: boolean
  command?: string
  suppressions?: AuditSuppression[]
  files?: () => string[]
  changed?: () => string[]
  read?: (file: string) => string
  dependency?: (files: string[]) => AuditFinding[]
}

const lines = (value: string) => value.split(/\r?\n/).map(s => s.trim()).filter(Boolean)

export function applySuppressions(findings: AuditFinding[], suppressions: AuditSuppression[] = [], now = new Date()): AuditFinding[] {
  return findings.filter(finding => !suppressions.some(s => s.reason.trim() && s.ruleId === finding.ruleId && (!s.file || s.file === finding.file) && (!s.expires || Date.parse(s.expires) >= now.getTime())))
}

export function runAudit(targetDir: string, opts: AuditOptions = {}): AuditResult {
  try {
    const files = opts.files?.() ?? lines(execFileSync('git', ['ls-files'], { cwd: targetDir }).toString())
    const changed = opts.changed?.() ?? lines(execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: targetDir }).toString())
    const read = opts.read ?? ((file: string) => readFileSync(join(targetDir, file), 'utf8'))
    let findings: AuditFinding[] = []
    for (const file of files) {
      try { findings.push(...scanSecrets(file, read(file))) } catch { /* binary/deleted file */ }
    }
    findings.push(...scanSensitiveChanges(changed))
    if (opts.command) {
      try { execSync(opts.command, { cwd: targetDir, stdio: 'pipe' }) }
      catch { findings.push({ ruleId: 'audit.custom-command', severity: 'high', message: `Audit command failed: ${opts.command}`, file: '.yoke/config.yaml' }) }
    } else {
      const dependency = opts.dependency ?? ((repoFiles: string[]) => {
        const command = dependencyAuditCommand(repoFiles)
        if (!command) return []
        try { return parseDependencyAudit(execFileSync(command[0], command[1], { cwd: targetDir, stdio: ['ignore', 'pipe', 'pipe'] }).toString()) }
        catch (error) { return parseDependencyAudit(String((error as { stdout?: unknown }).stdout ?? '{}')) }
      })
      findings.push(...dependency(files))
    }
    findings = applySuppressions(findings, opts.suppressions).sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || a.ruleId.localeCompare(b.ruleId))
    return { code: findings.some(f => f.severity === 'high' || f.severity === 'critical') ? 1 : 0, findings }
  } catch (error) {
    return { code: 2, findings: [], error: (error as Error).message }
  }
}

export function printAudit(result: AuditResult, json = false): void {
  if (json) { console.log(JSON.stringify(result)); return }
  for (const finding of result.findings) console.log(`${finding.severity.toUpperCase()} ${finding.ruleId} ${finding.file}${finding.line ? `:${finding.line}` : ''} — ${finding.message}`)
  if (result.error) console.error(`Audit unavailable: ${result.error}`)
  else console.log(result.code === 0 ? '✓ audit passed' : `✗ audit found ${result.findings.length} issue(s)`)
}
