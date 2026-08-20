import type { AppliedAction } from './apply.js'
import type { Agent } from './config.js'
import type { UiDetection } from './ui-detect.js'

export interface ReportMeta {
  loopEnabled: boolean
  detectedAgents: Agent[]
  ui?: UiDetection
}

export function formatReport(applied: AppliedAction[], meta: ReportMeta): string {
  const count = (s: AppliedAction['status']) => applied.filter(a => a.status === s).length
  const lines: string[] = []
  lines.push('Yoke retrofit:')
  for (const a of applied) {
    const note = a.backedUp ? ` (backup: ${a.backedUp})` : ''
    lines.push(`  ${a.status.padEnd(11)} ${a.target}${note}`)
  }
  lines.push('')
  lines.push(`Detected agents: ${meta.detectedAgents.length ? meta.detectedAgents.join(', ') : 'none'}`)
  if (meta.ui) {
    lines.push(meta.ui.detected
      ? `UI project: detected (${meta.ui.signals.join('; ')})`
      : 'UI project: not detected')
  }
  lines.push(`Summary: ${count('created')} created, ${count('overwritten')} overwritten, ${count('merged')} merged, ${count('unchanged')} unchanged`)
  lines.push(`Loop: ${meta.loopEnabled ? 'enabled' : 'disabled'}`)
  return lines.join('\n')
}
