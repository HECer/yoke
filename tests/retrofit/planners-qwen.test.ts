import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as parseToml } from 'smol-toml'
import { planQwen } from '../../src/retrofit/planners/qwen.js'

let canon: string
beforeEach(() => {
  canon = mkdtempSync(join(tmpdir(), 'yoke-canon-'))
  const w = (rel: string, c: string | Uint8Array) => { mkdirSync(join(canon, rel, '..'), { recursive: true }); writeFileSync(join(canon, rel), c) }
  w('manifest.yaml', `
name: yoke-canon
version: 0.1.0
agents: [qwen]
skills:
  - { id: tdd, path: skills/tdd, kind: methodology, invocation: auto }
  - { id: release, path: skills/release, kind: role, invocation: manual }
policy: []
loop: { spec: loop/loop-spec.md, prdSchema: loop/prd.schema.md }
tools: []
`)
  w('AGENTS.md', '# Baseline\n')
  w('tools/qwen-rtk-hook.mjs', '// hook fixture\n')
  w('tools/gemini-rtk-hook.mjs', '// old hook fixture\n')
  w('skills/tdd/SKILL.md', '---\nname: tdd\ndescription: Test-driven development\n---\nbody')
  w('skills/tdd/references/guide.md', '# Guide\n')
  w('skills/tdd/assets/sample.bin', new Uint8Array([0, 255, 4]))
  w('skills/release/SKILL.md', '---\nname: release\ndescription: Release\n---\nmanual body')
})
afterEach(() => { rmSync(canon, { recursive: true, force: true }) })

describe('planQwen', () => {
  it('uses Qwen PreToolUse hooks and preserves manual skill invocation', () => {
    const actions = planQwen(canon, '/t')
    const settings = JSON.parse(String(actions.find(a => a.target === '.qwen/settings.json')!.content))
    expect(settings.hooks.PreToolUse[0].matcher).toBe('^run_shell_command$')
    expect(settings.hooks.BeforeTool).toBeUndefined()
    expect(String(actions.find(a => a.target === '.qwen/skills/release/SKILL.md')!.content)).toContain('disable-model-invocation: true')
    expect(String(actions.find(a => a.target === '.qwen/skills/tdd/SKILL.md')!.content)).not.toContain('disable-model-invocation: true')
  })

  it('plans QWEN.md, a command toml per skill, and settings.json', () => {
    const targets = planQwen(canon, '/t').map(a => a.target)
    expect(targets).toContain('QWEN.md')
    expect(targets).toContain('.qwen/commands/tdd.toml')
    expect(targets).toContain('.qwen/settings.json')
  })

  it('copies complete skill packages next to generated Qwen commands', () => {
    const actions = planQwen(canon, '/t')

    expect(actions.map(action => action.target)).toEqual(expect.arrayContaining([
      '.qwen/skills/tdd/SKILL.md',
      '.qwen/skills/tdd/references/guide.md',
      '.qwen/skills/tdd/assets/sample.bin',
      '.qwen/skills/release/SKILL.md',
    ]))
  })

  it('advertises only automatic skills in the compact context index', () => {
    const qwenMd = String(planQwen(canon, '/t').find(action => action.target === 'QWEN.md')!.content)

    expect(qwenMd).toContain('/tdd')
    expect(qwenMd).not.toContain('/release')
    expect(planQwen(canon, '/t').map(action => action.target)).toContain('.qwen/commands/release.toml')
  })

  it('QWEN.md template ships an empty preserve block scaffold', () => {
    const qwenMd = planQwen(canon, '/t').find(a => a.target === 'QWEN.md')!
    expect(qwenMd.content).toContain('<!-- yoke:preserve:start -->')
    expect(qwenMd.content).toContain('<!-- yoke:preserve:end -->')
  })

  it('settings.json wires mcpServers and AGENTS.md context', () => {
    const s = planQwen(canon, '/t').find(a => a.target === '.qwen/settings.json')!
    const cfg = JSON.parse(s.content)
    expect(Object.keys(cfg.mcpServers)).toContain('graphify')
    expect(cfg.context.fileName).toContain('AGENTS.md')
  })

  it('a command toml carries description and prompt', () => {
    const cmd = planQwen(canon, '/t').find(a => a.target === '.qwen/commands/tdd.toml')!
    expect(cmd.content).toContain('description')
    expect(cmd.content).toContain('prompt')
    expect(cmd.content).toContain('Test-driven development')
  })

  it('generates valid TOML even when the description has backslashes and quotes', () => {
    const desc = 'path C:\\Users\\ and a "quote"'
    writeFileSync(join(canon, 'skills/tdd/SKILL.md'), `---\nname: tdd\ndescription: '${desc.replace(/'/g, "''")}'\n---\nbody`)
    const cmd = planQwen(canon, '/t').find(a => a.target === '.qwen/commands/tdd.toml')!
    // The whole guarantee: substring asserts can't catch invalid TOML; parsing can.
    const parsed = parseToml(cmd.content) as { description: string; prompt: string }
    expect(parsed.description).toBe(desc)
    // prompt now carries the skill body (the fixture body is "body"), not the description
    expect(parsed.prompt).toContain('body')
  })

  it('collapses a multi-line description into valid single-line TOML', () => {
    writeFileSync(join(canon, 'skills/tdd/SKILL.md'),
      '---\nname: tdd\ndescription: |\n  Line one of the description.\n  Line two continues here.\n---\nbody')
    const cmd = planQwen(canon, '/t').find(a => a.target === '.qwen/commands/tdd.toml')!
    const parsed = parseToml(cmd.content) as { description: string }
    expect(parsed.description).not.toContain('\n')
    expect(parsed.description).toContain('Line one of the description.')
    expect(parsed.description).toContain('Line two continues here.')
  })

  it('embeds the full skill body in the command prompt, not just the description', () => {
    writeFileSync(join(canon, 'skills/tdd/SKILL.md'),
      '---\nname: tdd\ndescription: Test-driven development\n---\n# TDD\n\nWrite the failing test FIRST, then the minimal code. Refactor.')
    const cmd = planQwen(canon, '/t').find(a => a.target === '.qwen/commands/tdd.toml')!
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
    const cmd = planQwen(canon, '/t').find(a => a.target === '.qwen/commands/tdd.toml')!
    const parsed = parseToml(cmd.content) as { prompt: string }
    expect(parsed.prompt).toContain('npm test')
    expect(parsed.prompt).toContain('const a = 1')
  })
})
