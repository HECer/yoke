import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { collectMetadata, discoverTestCount, updateReadme } from '../../scripts/release-metadata.mjs'

describe('release metadata', () => {
  it('discovers Windows execution regressions on another platform when metadata includes platform tests', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'yoke-platform-discovery-'))
    const files = ['tests/check/child-environment.test.ts', 'tests/loop/runner-preflight.test.ts', 'tests/agents/windows-launch.test.ts']
    const expected = [
      'uses a normalized child PATH for asynchronous acceptance without changing the parent',
      'preflights the original provider before the synchronous watchdog launch',
      'returns complete zero usage when original provider preflight proves no model started',
      'preserves reviewer preflight evidence and returns an infrastructure review outcome',
      'returns measured zero model usage and structured evidence for provider preflight failure',
    ]
    try {
      const config = join(fixture, 'vitest.config.mjs')
      // Simulate Linux only in test registration; keep Node/Vite's host platform intact.
      writeFileSync(config, `export default { plugins: [{ name: 'registration-platform', enforce: 'pre', transform(code, id) { if (${JSON.stringify(files)}.some(file => id.replaceAll('\\\\', '/').endsWith(file))) return code.replaceAll('process.platform', "'linux'"); } }], test: { include: ['tests/**/*.test.ts'], fileParallelism: false } };`)
      const count = discoverTestCount(process.cwd(), (command: string, args: string[], options: Parameters<typeof execFileSync>[2]) => {
        const tests = JSON.parse(String(execFileSync(command, [...args.filter(arg => arg !== '--json'), ...files, '--config', config, '--json'], options))) as { name: string }[]
        return JSON.stringify(tests.filter(test => expected.includes(test.name)))
      })
      expect(count).toBe(5)
    } finally { rmSync(fixture, { recursive: true, force: true }) }
  }, 30_000)

  it('lists every platform test through a host-independent discovery environment', () => {
    let receivedEnv: NodeJS.ProcessEnv | undefined
    const execute = (_command: string, _args: string[], options: { env?: NodeJS.ProcessEnv }) => {
      receivedEnv = options.env
      return JSON.stringify([{ name: 'one' }, { name: 'two' }, { name: 'posix-only' }])
    }

    expect(discoverTestCount('/project', execute)).toBe(3)
    expect(receivedEnv?.YOKE_INCLUDE_PLATFORM_TESTS).toBe('1')
  })

  it('collects package, canon, agent, skill, and test facts', () => {
    const root = mkdtempSync(join(tmpdir(), 'yoke-meta-'))
    try {
      mkdirSync(join(root, 'canon'), { recursive: true })
      writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }))
      writeFileSync(join(root, 'canon', 'manifest.yaml'), [
        'version: 1.2.3',
        'agents: [claude, codex, gemini]',
        'skills:',
        '  - { id: tdd, path: skills/tdd, kind: methodology }',
        '  - { id: review, path: skills/review, kind: role }',
      ].join('\n'))

      expect(collectMetadata(root, 'Tests 487 passed')).toEqual({
        version: '1.2.3',
        agents: ['claude', 'codex', 'gemini'],
        skillCount: 2,
        testCount: 487,
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('updates only release metadata markers in README', () => {
    const before = [
      '<!-- yoke:version:start -->old<!-- yoke:version:end -->',
      '<!-- yoke:tests:start -->0<!-- yoke:tests:end -->',
      '<!-- yoke:skills:start -->0<!-- yoke:skills:end -->',
      '<!-- yoke:agents:start -->old<!-- yoke:agents:end -->',
      '![Tests](https://img.shields.io/badge/tests-12%20passing-brightgreen.svg)',
      'npm test          # vitest (12 tests)',
      'Tests behind the gate — 12 of them.',
      'keep me',
    ].join('\n')

    expect(updateReadme(before, {
      version: '1.0.0', testCount: 500, skillCount: 28,
      agents: ['claude', 'codex', 'gemini'],
    })).toBe([
      '<!-- yoke:version:start -->1.0.0<!-- yoke:version:end -->',
      '<!-- yoke:tests:start -->500<!-- yoke:tests:end -->',
      '<!-- yoke:skills:start -->28<!-- yoke:skills:end -->',
      '<!-- yoke:agents:start -->Claude | Codex | Gemini<!-- yoke:agents:end -->',
      '![Tests](https://img.shields.io/badge/tests-500%20passing-brightgreen.svg)',
      'npm test          # vitest (500 tests)',
      'Tests behind the gate — 500 of them.',
      'keep me',
    ].join('\n'))
  })

  it('uses harness display names instead of lowercased product spellings', () => {
    const readme = '<!-- yoke:version:start -->old<!-- yoke:version:end -->\n<!-- yoke:tests:start -->0<!-- yoke:tests:end -->\n<!-- yoke:skills:start -->0<!-- yoke:skills:end -->\n<!-- yoke:agents:start -->old<!-- yoke:agents:end -->'
    expect(updateReadme(readme, { version: '1.0.0', testCount: 1, skillCount: 1, agents: ['opencode', 'kilo', 'pi'] }))
      .toContain('<!-- yoke:agents:start -->OpenCode | Kilo | Pi<!-- yoke:agents:end -->')
  })

  it('ships the documented output compaction benchmark', () => {
    const root = process.cwd()
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { files: string[] }
    expect(pkg.files).toContain('bench/output-compaction.mjs')
    expect(existsSync(join(root, 'bench', 'output-compaction.mjs'))).toBe(true)
  })
})
