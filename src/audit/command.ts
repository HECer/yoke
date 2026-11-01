import { execFileSync, execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dependencyAuditCommand, dependencyAuditCoverage, parseDependencyAudit } from './dependencies.js'
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
  commandRunner?: (command: string, targetDir: string) => { readonly passed: boolean; readonly summary: string }
}

const lines = (value: string) => value.split(/\r?\n/).map(s => s.trim()).filter(Boolean)

export function applySuppressions(findings: AuditFinding[], suppressions: AuditSuppression[] = [], now = new Date()): AuditFinding[] {
  return findings.filter(finding => !suppressions.some(s => s.reason.trim() && s.ruleId === finding.ruleId && (!s.file || s.file === finding.file) && (!s.expires || Date.parse(s.expires) >= now.getTime())))
}

export function runAudit(targetDir: string, opts: AuditOptions = {}): AuditResult {
  let dependencyStatus: AuditResult['dependencyStatus'] = opts.command ? 'custom' : 'unavailable'
  let dependencyCoverage: AuditResult['dependencyCoverage']
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
      let commandResult: { readonly passed: boolean; readonly summary: string }
      if (opts.commandRunner) commandResult = opts.commandRunner(opts.command, targetDir)
      else {
        try {
          execSync(opts.command, { cwd: targetDir, stdio: 'pipe' })
          commandResult = { passed: true, summary: `audit passed: ${opts.command}` }
        } catch {
          commandResult = { passed: false, summary: `Audit command failed: ${opts.command}` }
        }
      }
      if (!commandResult.passed) findings.push({ ruleId: 'audit.custom-command', severity: 'high', message: commandResult.summary, file: '.yoke/config.yaml' })
    } else {
      let unsupported = false
      const dependency = opts.dependency ?? ((repoFiles: string[]) => {
        const command = dependencyAuditCommand(repoFiles)
        dependencyCoverage = dependencyAuditCoverage(repoFiles)
        if (!command) {
          unsupported = true
          return [{ ruleId: 'dependencies.unsupported', severity: 'info', message: 'Dependency audit not performed: no supported root lockfile (Yarn requires an explicit audit.command); configure audit.command for this ecosystem', file: 'package manifest' } satisfies AuditFinding]
        }
        try { return parseDependencyAudit(execFileSync(command[0], command[1], { cwd: targetDir, stdio: ['ignore', 'pipe', 'pipe'] }).toString()) }
        catch (error) {
          const output = (error as { stdout?: unknown }).stdout
          if (output === undefined) throw error
          const result = parseDependencyAudit(String(output))
          if (result.length === 0) throw new Error('Dependency audit exited unsuccessfully without a completed vulnerability result')
          return result
        }
      })
      const dependencyFindings = dependency(files)
      dependencyStatus = unsupported ? 'unsupported' : dependencyFindings.length ? 'findings' : 'clean'
      findings.push(...dependencyFindings)
      if (!unsupported && dependencyCoverage?.unscannedLockfiles.length) {
        dependencyStatus = 'partial'
        findings.push({ ruleId: 'dependencies.partial-coverage', severity: 'info', file: 'package manifest',
          message: `Dependency coverage is limited to ${dependencyCoverage.scannedLockfiles.join(', ')}; unscanned lockfiles: ${dependencyCoverage.unscannedLockfiles.join(', ')}. Configure audit.command for complete multi-ecosystem coverage.` })
      }
    }
    findings = applySuppressions(findings, opts.suppressions).sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || a.ruleId.localeCompare(b.ruleId))
    return { code: findings.some(f => f.severity === 'high' || f.severity === 'critical') ? 1 : 0, findings, dependencyStatus, ...(dependencyCoverage ? { dependencyCoverage } : {}) }
  } catch (error) {
    return { code: 2, findings: [], dependencyStatus, ...(dependencyCoverage ? { dependencyCoverage } : {}), error: (error as Error).message }
  }
}

export function printAudit(result: AuditResult, json = false): void {
  if (json) { console.log(JSON.stringify(result)); return }
  for (const finding of result.findings) console.log(`${finding.severity.toUpperCase()} ${finding.ruleId} ${finding.file}${finding.line ? `:${finding.line}` : ''} — ${finding.message}`)
  if (result.error) console.error(`Audit unavailable: ${result.error}`)
  else console.log(result.code === 0 ? `✓ configured audit checks passed${result.dependencyStatus === 'unsupported' ? '; dependency coverage unavailable' : result.dependencyStatus === 'partial' ? '; dependency coverage incomplete' : ''}` : `✗ audit found ${result.findings.length} issue(s)`)
}
