import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanText, scanDir, TELLS } from '../../src/scan/design.js'

describe('scanText', () => {
  it('flags AI-purple hex and tailwind purple gradients', () => {
    expect(scanText('color: #6c5ce7;').some(m => m.tell.name === 'ai-purple')).toBe(true)
    expect(scanText('<div class="bg-gradient-to-r from-purple-500 to-violet-600">').some(m => m.tell.name === 'ai-purple')).toBe(true)
  })
  it('flags gradient hero text (clip-text + transparent)', () => {
    expect(scanText('<h1 class="bg-clip-text text-transparent bg-gradient-to-r">').some(m => m.tell.name === 'gradient-clip-text')).toBe(true)
  })
  it('flags neon glow', () => {
    expect(scanText('class="shadow-[0_0_20px_rgba(0,255,255,0.7)]"').some(m => m.tell.name === 'neon-glow')).toBe(true)
    expect(scanText('box-shadow: 0 0 40px #0ff;').some(m => m.tell.name === 'neon-glow')).toBe(true)
  })
  it('flags gradient overload', () => {
    expect(scanText('background: linear-gradient(90deg, #fff, #000);').some(m => m.tell.name === 'gradient-overload')).toBe(true)
  })
  it('does not flag clean, conventional styles', () => {
    expect(scanText('class="rounded-lg border bg-white p-4 text-slate-800"')).toEqual([])
    expect(scanText('color: #1d1d1f; background: #f5f5f7;')).toEqual([])
  })
  it('counts at most one finding per tell per line', () => {
    const m = scanText('from-purple-500 via-purple-600 to-purple-700')
    expect(m.filter(x => x.tell.name === 'ai-purple')).toHaveLength(1)
  })
})

describe('scanDir', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-scan-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('walks source files, aggregates a weighted score, and records file:line', () => {
    writeFileSync(join(dir, 'a.css'), 'h1 { color: #6c5ce7; }\n')               // ai-purple weight 2
    writeFileSync(join(dir, 'b.tsx'), '\n<span class="shadow-[0_0_10px_#f0f]" />') // neon-glow weight 2, line 2
    const res = scanDir(dir)
    expect(res.score).toBe(4)
    expect(res.findings.some(f => f.file.endsWith('a.css') && f.line === 1 && f.tell === 'ai-purple')).toBe(true)
    expect(res.findings.some(f => f.file.endsWith('b.tsx') && f.line === 2 && f.tell === 'neon-glow')).toBe(true)
  })
  it('skips node_modules / dist / .yoke and non-source extensions', () => {
    mkdirSync(join(dir, 'node_modules'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'x.css'), 'color:#6c5ce7;')
    writeFileSync(join(dir, 'readme.md'), 'a #6c5ce7 mention')
    expect(scanDir(dir).score).toBe(0)
  })
  it('accepts an injected tell set', () => {
    writeFileSync(join(dir, 'a.css'), 'foo')
    const tells = [{ name: 'foo', weight: 5, test: (l: string) => l.includes('foo'), hint: 'h' }]
    expect(scanDir(dir, tells).score).toBe(5)
  })
  it('skips test/spec/story files (their slop is fixtures, not shipped UI)', () => {
    writeFileSync(join(dir, 'Hero.test.tsx'), 'color:#6c5ce7;')
    writeFileSync(join(dir, 'Hero.spec.ts'), 'box-shadow: 0 0 40px #0ff;')
    writeFileSync(join(dir, 'Hero.stories.tsx'), 'from-purple-500')
    expect(scanDir(dir).score).toBe(0)
    writeFileSync(join(dir, 'Hero.tsx'), 'color:#6c5ce7;') // a real source file IS scanned
    expect(scanDir(dir).score).toBe(2)
  })
})

it('TELLS is the curated non-empty default set', () => {
  expect(TELLS.map(t => t.name)).toEqual(
    expect.arrayContaining(['ai-purple', 'gradient-clip-text', 'neon-glow', 'gradient-overload']),
  )
})
