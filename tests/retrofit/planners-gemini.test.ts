import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as parseToml } from 'smol-toml'
import { planGemini } from '../../src/retrofit/planners/gemini.js'

let canon: string
beforeEach(() => {
  canon = mkdtempSync(join(tmpdir(), 'yoke-canon-'))
  const w = (rel: string, c: string) => { mkdirSync(join(canon, rel, '..'), { recursive: true }); writeFileSync(join(canon, rel), c) }
  w('manifest.yaml', `
name: yoke-canon
version: 0.1.0
agents: [gemini]
skills:
  - { id: tdd, path: skills/tdd, kind: methodology }
policy: []
loop: { spec: loop/loop-spec.md, prdSchema: loop/prd.schema.md }
tools: []
`)
  w('AGENTS.md', '# Baseline\n')
  w('skills/tdd/SKILL.md', '---\nname: tdd\ndescription: Test-driven development\n---\nbody')
})
afterEach(() => { rmSync(canon, { recursive: true, force: true }) })

describe('planGemini', () => {
  it('plans GEMINI.md, a command toml per skill, and settings.json', () => {
    const targets = planGemini(canon, '/t').map(a => a.target)
    expect(targets).toContain('GEMINI.md')
    expect(targets).toContain('.gemini/commands/tdd.toml')
    expect(targets).toContain('.gemini/settings.json')
  })

  it('GEMINI.md template ships an empty preserve block scaffold', () => {
    const geminiMd = planGemini(canon, '/t').find(a => a.target === 'GEMINI.md')!
    expect(geminiMd.content).toContain('<!-- yoke:preserve:start -->')
    expect(geminiMd.content).toContain('<!-- yoke:preserve:end -->')
  })

  it('settings.json wires mcpServers and AGENTS.md context', () => {
    const s = planGemini(canon, '/t').find(a => a.target === '.gemini/settings.json')!
    const cfg = JSON.parse(s.content)
    expect(Object.keys(cfg.mcpServers)).toContain('graphify')
    expect(cfg.context.fileName).toContain('AGENTS.md')
  })

  it('a command toml carries description and prompt', () => {
    const cmd = planGemini(canon, '/t').find(a => a.target === '.gemini/commands/tdd.toml')!
    expect(cmd.content).toContain('description')
    expect(cmd.content).toContain('prompt')
    expect(cmd.content).toContain('Test-driven development')
  })

  it('generates valid TOML even when the description has backslashes and quotes', () => {
    const desc = 'path C:\\Users\\ and a "quote"'
    writeFileSync(join(canon, 'skills/tdd/SKILL.md'), `---\nname: tdd\ndescription: '${desc.replace(/'/g, "''")}'\n---\nbody`)
    const cmd = planGemini(canon, '/t').find(a => a.target === '.gemini/commands/tdd.toml')!
    // The whole guarantee: substring asserts can't catch invalid TOML; parsing can.
    const parsed = parseToml(cmd.content) as { description: string; prompt: string }
    expect(parsed.description).toBe(desc)
    // prompt now carries the skill body (the fixture body is "body"), not the description
    expect(parsed.prompt).toContain('body')
  })

  it('collapses a multi-line description into valid single-line TOML', () => {
    writeFileSync(join(canon, 'skills/tdd/SKILL.md'),
      '---\nname: tdd\ndescription: |\n  Line one of the description.\n  Line two continues here.\n---\nbody')
    const cmd = planGemini(canon, '/t').find(a => a.target === '.gemini/commands/tdd.toml')!
    const parsed = parseToml(cmd.content) as { description: string }
    expect(parsed.description).not.toContain('\n')
    expect(parsed.description).toContain('Line one of the description.')
    expect(parsed.description).toContain('Line two continues here.')
  })

  it('embeds the full skill body in the command prompt, not just the description', () => {
    writeFileSync(join(canon, 'skills/tdd/SKILL.md'),
      '---\nname: tdd\ndescription: Test-driven development\n---\n# TDD\n\nWrite the failing test FIRST, then the minimal code. Refactor.')
    const cmd = planGemini(canon, '/t').find(a => a.target === '.gemini/commands/tdd.toml')!
    const parsed = parseToml(cmd.content) as { description: string; prompt: string }
    // description stays the one-line summary
    expect(parsed.description).toBe('Test-driven development')
    // prompt now carries the actual body, not just the description
    expect(parsed.prompt).toContain('Write the failing test FIRST')
    expect(parsed.prompt).toContain('Refactor')
  })
  it('produces valid TOML for a body with quotes, backslashes and code fences', () => {
    writeFileSync(join(canon, 'skills/tdd/SKILL.md'),
      '---\nname: tdd\ndescription: d\n---\n# Body\n\nRun `npm test` with a "quote" and a path C:\\\\x.\n\n```js\nconst a = 1\n```\n')
    const cmd = planGemini(canon, '/t').find(a => a.target === '.gemini/commands/tdd.toml')!
    const parsed = parseToml(cmd.content) as { prompt: string }
    expect(parsed.prompt).toContain('npm test')
    expect(parsed.prompt).toContain('const a = 1')
  })
})
