import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../src/cli.js'
import { loadConfig } from '../src/retrofit/config.js'
import { loopStatus } from '../src/loop/run-command.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-eff-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('v1.21.0 efficiency features', () => {
  it('does NOT automatically force reasoning effort on standard retrofit', async () => {
    expect(await main(['retrofit', dir, '--agent=codex'])).toBe(0)
    const config = loadConfig(dir)
    expect(config?.runner?.reasoningEffort).toBeUndefined()
  })

  it('configures runner model and reasoning effort when explicitly specified in retrofit', async () => {
    expect(await main([
      'retrofit', dir,
      '--agent=claude',
      '--runner-model=claude-3-7-sonnet',
      '--runner-reasoning=high',
    ])).toBe(0)
    const config = loadConfig(dir)
    expect(config?.runner?.model).toBe('claude-3-7-sonnet')
    expect(config?.runner?.reasoningEffort).toBe('high')
  })

  it('prunes worktrees via yoke worktrees prune and cleans them during retrofit --clean-worktrees', async () => {
    const wtDir = join(dir, '.yoke', 'worktrees', 'STORY-99')
    mkdirSync(wtDir, { recursive: true })
    expect(existsSync(wtDir)).toBe(true)

    // Verify list command
    expect(await main(['worktrees', 'list', dir])).toBe(0)

    // Verify prune command
    expect(await main(['worktrees', 'prune', dir])).toBe(0)
    expect(existsSync(wtDir)).toBe(false)

    // Recreate worktree and verify retrofit --clean-worktrees
    mkdirSync(wtDir, { recursive: true })
    expect(existsSync(wtDir)).toBe(true)
    expect(await main(['retrofit', dir, '--clean-worktrees', '--agent=claude'])).toBe(0)
    expect(existsSync(wtDir)).toBe(false)
  })

  it('renders a compact zero-token status when --compact is requested', () => {
    const out = loopStatus(dir, undefined, { compact: true })
    expect(out).toContain('state=')
    expect(out).toContain('prd=')
    expect(out.split('\n')).toHaveLength(1)
  })
})
