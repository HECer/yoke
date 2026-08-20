import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectUiProject } from '../../src/retrofit/ui-detect.js'

let dir: string

function write(relativePath: string, content = ''): void {
  const target = join(dir, relativePath)
  mkdirSync(join(target, '..'), { recursive: true })
  writeFileSync(target, content)
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-ui-detect-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('detectUiProject', () => {
  it('detects supported framework dependencies with explained evidence', () => {
    write('package.json', JSON.stringify({ dependencies: { react: '^19.0.0' } }))

    expect(detectUiProject(dir)).toEqual({ detected: true, signals: ['dependency: react'] })
  })

  it.each(['tsx', 'jsx', 'vue', 'svelte', 'astro'])('detects a source .%s file', extension => {
    write(`src/pages/home.${extension}`, 'content')

    const result = detectUiProject(dir)

    expect(result.detected).toBe(true)
    expect(result.signals).toContain(`source: src/pages/home.${extension}`)
  })

  it('detects an existing smoke-flow configuration', () => {
    write('.yoke/config.yaml', 'smoke:\n  baseUrl: http://localhost:3000\n  flows:\n    - { name: home, path: / }\n')

    expect(detectUiProject(dir).signals).toContain('config: smoke flows')
  })

  it('does not classify a non-UI TypeScript project', () => {
    write('package.json', JSON.stringify({ devDependencies: { typescript: '^6.0.0' } }))
    write('src/index.ts', 'export const answer = 42')

    expect(detectUiProject(dir)).toEqual({ detected: false, signals: [] })
  })

  it('ignores UI-shaped files in dependencies, generated output, fixtures, and Yoke runtime data', () => {
    for (const path of ['node_modules/pkg/a.tsx', 'dist/a.jsx', 'tests/fixtures/a.vue', '.yoke/proof/a.svelte']) write(path)

    expect(detectUiProject(dir)).toEqual({ detected: false, signals: [] })
  })
})
