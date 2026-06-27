import { describe, it, expect } from 'vitest'
import { formatReport } from '../../src/retrofit/report.js'
import type { AppliedAction } from '../../src/retrofit/apply.js'

const applied: AppliedAction[] = [
  { target: 'AGENTS.md', status: 'created', reason: 'baseline' },
  { target: 'CLAUDE.md', status: 'overwritten', backedUp: '/b/CLAUDE.md', reason: 'entry' },
  { target: '.claude/skills/tdd/SKILL.md', status: 'unchanged', reason: 'skill: tdd' },
]

describe('formatReport', () => {
  it('summarizes counts and loop state', () => {
    const out = formatReport(applied, { loopEnabled: false, detectedAgents: [] })
    expect(out).toContain('1 created')
    expect(out).toContain('1 overwritten')
    expect(out).toContain('1 unchanged')
    expect(out).toContain('Loop: disabled')
  })

  it('lists each target with its status', () => {
    const out = formatReport(applied, { loopEnabled: true, detectedAgents: ['claude'] })
    expect(out).toContain('AGENTS.md')
    expect(out).toContain('Loop: enabled')
  })

  it('reports detected agents', () => {
    const out = formatReport(applied, { loopEnabled: false, detectedAgents: ['claude', 'codex'] })
    expect(out).toContain('Detected agents: claude, codex')
  })

  it('reports none when no agents are detected', () => {
    const out = formatReport(applied, { loopEnabled: false, detectedAgents: [] })
    expect(out).toContain('Detected agents: none')
  })
})
