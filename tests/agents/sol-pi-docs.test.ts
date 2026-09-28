import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8')
const guide = readFileSync(new URL('../../docs/SOL-PI.md', import.meta.url), 'utf8')

describe('SoL-Pi user documentation', () => {
  it('solpi-paper-results-documented', () => {
    expect(readme).toContain('docs/SOL-PI.md')
    expect(guide).toContain('https://arxiv.org/abs/2609.20519')
    expect(guide).toContain('51 publicly released tasks')
    expect(guide).toContain('49.0%')
    expect(guide).toContain('33.2%')
    expect(guide).toContain('44.833')
    expect(guide).toContain('42.003')
    expect(guide).toContain('47.208')
    expect(guide).toContain('44.7%')
    expect(guide).toContain('33.5%')
    expect(guide).toContain('44.756')
    expect(guide).toContain('42.224')
    expect(guide).toContain('15 of 63')
    expect(guide).toContain('18 of 63')
    expect(guide).toContain('26.3%')
    expect(guide).toMatch(/not a project-level (?:prediction|guarantee)/iu)
  })

  it('solpi-security-limits-documented', () => {
    expect(guide).toContain('off by default')
    expect(guide).toContain('actionFusion')
    expect(guide).toContain('observationPack')
    expect(guide).toContain('evidencePreservingReducer')
    expect(guide).toContain('onlineContextCompact')
    expect(guide).toContain('Pi project trust')
    expect(guide).toContain('Yoke does not grant trust')
    expect(guide).toContain('Node.js 22.19')
    expect(guide).toContain('diagnostic-log content')
    expect(guide).toContain('configured reducer model')
    expect(guide).toContain('.yoke/config.yaml')
    expect(guide).toContain('.pi/sol-pi.json')
    expect(guide).toContain('Yoke restores the file')
    expect(guide).toContain('read,bash,edit,write')
    expect(guide).toContain('read,grep,find,ls')
  })
})
