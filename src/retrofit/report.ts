import type { AppliedAction } from './apply.js'
import type { Agent } from './config.js'

export interface ReportMeta {
  loopEnabled: boolean
  detectedAgents: Agent[]
}

export function formatReport(applied: AppliedAction[], meta: ReportMeta): string {
  const count = (s: AppliedAction['status']) => applied.filter(a => a.status === s).length
  const lines: string[] = []
  lines.push('Forge retrofit (Claude Code):')
  for (const a of applied) {
    const note = a.backedUp ? ` (backup: ${a.backedUp})` : ''
    lines.push(`  ${a.status.padEnd(11)} ${a.target}${note}`)
  }
  lines.push('')
  lines.push(`Detected agents: ${meta.detectedAgents.length ? meta.detectedAgents.join(', ') : 'none'}`)
  lines.push(`Summary: ${count('created')} created, ${count('overwritten')} overwritten, ${count('unchanged')} unchanged`)
  lines.push(`Loop: ${meta.loopEnabled ? 'enabled' : 'disabled'}`)
  return lines.join('\n')
}
