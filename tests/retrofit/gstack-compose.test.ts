import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { planClaude } from '../../src/retrofit/planners/claude.js'
import { planCodex } from '../../src/retrofit/planners/codex.js'
import { planGemini } from '../../src/retrofit/planners/gemini.js'

const canonDir = fileURLToPath(new URL('../../canon', import.meta.url))
const claudeMd = (actions: { target: string; content: string }[]) =>
  actions.find(a => a.target === 'CLAUDE.md')?.content ?? ''

describe('gstack compose in Claude planner', () => {
  it('adds a Composed tools section to CLAUDE.md when gstack is detected', () => {
    const md = claudeMd(planClaude(canonDir, '.', false, 'graphify', true))
    expect(md).toMatch(/Composed tools/i)
    expect(md).toContain('/qa')
    expect(md).toContain('/cso')
    expect(md).toContain('/ship')
  })
  it('omits the section when gstack is not detected', () => {
    const md = claudeMd(planClaude(canonDir, '.', false, 'graphify', false))
    expect(md).not.toMatch(/Composed tools/i)
  })
  it('never adds the section to Codex or Gemini artifacts', () => {
    for (const content of [...planCodex(canonDir, '.', 'graphify'), ...planGemini(canonDir, '.', 'graphify')].map(a => a.content)) {
      expect(content).not.toMatch(/Composed tools/i)
    }
  })
})
