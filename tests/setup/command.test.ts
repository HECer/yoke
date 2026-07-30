import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSetup } from '../../src/setup/command.js'
import { loadConfig, saveConfig } from '../../src/retrofit/config.js'
import { main } from '../../src/cli.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-setup-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('yoke setup', () => {
  it('asks the setup questions and persists the selected Codex workflow', async () => {
    const answers = ['codex', 'serena', 'yes', 'codex', 'critical']
    const questions: string[] = []
    const code = await runSetup(dir, {
      host: 'codex', interactive: true,
      ask: async (question) => { questions.push(question); return answers.shift()! },
    })
    expect(code).toBe(0)
    expect(questions).toHaveLength(5)
    expect(loadConfig(dir)).toMatchObject({
      agents: ['codex'], codeGraph: 'serena',
      loop: { enabled: true, decisionPolicy: 'critical' },
      runner: { agent: 'codex' },
    })
    expect(existsSync(join(dir, '.agents/skills/yoke-workflow/SKILL.md'))).toBe(true)
  })

  it('uses suitable host-aware defaults without prompting in non-interactive mode', async () => {
    expect(await runSetup(dir, { host: 'codex', interactive: false })).toBe(0)
    expect(loadConfig(dir)).toMatchObject({
      agents: ['codex'], codeGraph: 'graphify',
      loop: { enabled: true, decisionPolicy: 'auto' },
      runner: { agent: 'codex' },
    })
  })

  it('recovers an old empty agent list with a valid fallback runner', async () => {
    saveConfig(dir, { canonVersion: '1.0.0', agents: [], loop: { enabled: false } })
    expect(await runSetup(dir, { host: 'claude', interactive: false })).toBe(0)
    expect(loadConfig(dir)).toMatchObject({ agents: ['claude'], runner: { agent: 'claude' } })
  })

  it('deduplicates interactive agent selections and adds the selected runner', async () => {
    const answers = ['codex,codex', '', '', 'gemini', '']
    expect(await runSetup(dir, { host: 'codex', interactive: true, ask: async () => answers.shift()! })).toBe(0)
    expect(loadConfig(dir)).toMatchObject({ agents: ['codex', 'gemini'], runner: { agent: 'gemini' } })
  })

  it('preserves existing non-setup config while applying explicit setup choices', async () => {
    saveConfig(dir, {
      canonVersion: '1.0.0', agents: ['claude'], loop: { enabled: false, timeoutMinutes: 17 },
      verify: { command: 'npm run verify', retries: 2 }, runner: { permissions: 'read-only' },
    })
    expect(await runSetup(dir, { host: 'codex', agents: ['codex'], runner: 'codex', loop: true, interactive: false })).toBe(0)
    expect(loadConfig(dir)).toMatchObject({
      agents: ['claude', 'codex'], loop: { enabled: true, timeoutMinutes: 17, decisionPolicy: 'auto' },
      verify: { command: 'npm run verify', retries: 2 }, runner: { agent: 'codex', permissions: 'read-only' },
    })
  })

  it('rejects a partially invalid CLI agent list instead of silently dropping the typo', async () => {
    expect(await main(['setup', dir, '--yes', '--agent=codex,typo'])).toBe(1)
    expect(existsSync(join(dir, '.yoke/config.yaml'))).toBe(false)
  })
})
