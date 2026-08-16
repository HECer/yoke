import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { collectMetadata, updateReadme } from '../../scripts/release-metadata.mjs'

describe('release metadata', () => {
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

  it('ships the documented output compaction benchmark', () => {
    const root = process.cwd()
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { files: string[] }
    expect(pkg.files).toContain('bench/output-compaction.mjs')
    expect(existsSync(join(root, 'bench', 'output-compaction.mjs'))).toBe(true)
  })
})
