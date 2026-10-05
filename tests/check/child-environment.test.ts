import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { checkProjectAsync } from '../../src/check/command.js'

const roots: string[] = []
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); vi.unstubAllEnvs() })

it.runIf(process.platform === 'win32' || process.env.YOKE_INCLUDE_PLATFORM_TESTS === '1')('uses a normalized child PATH for asynchronous acceptance without changing the parent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-check-child-env-')); roots.push(root)
  mkdirSync(join(root, '.yoke'))
  vi.stubEnv('YOKE_STATE_DIR', join(root, 'state'))
  vi.stubEnv('LOCALAPPDATA', root)
  const nodeDir = dirname(process.execPath), projectBin = join(root, 'node_modules', '.bin')
  const parent = `${nodeDir};${projectBin};C:\\foreign\\node_modules\\.bin;${nodeDir.toUpperCase()};${process.env.PATH ?? ''}`
  vi.stubEnv('PATH', parent)
  writeFileSync(join(root, 'test.mjs'), `import assert from 'node:assert/strict'; const paths = process.env.PATH.split(';'); assert.equal(paths.filter(path => path.toLowerCase() === ${JSON.stringify(nodeDir.toLowerCase())}).length, 1); assert.ok(paths.includes(${JSON.stringify(projectBin)})); assert.ok(!paths.includes('C:\\\\foreign\\\\node_modules\\\\.bin')); assert.equal(process.cwd(), ${JSON.stringify(root)});`)
  writeFileSync(join(root, '.yoke', 'acceptance.yaml'), 'version: 1\ncriteria:\n- id: child-environment\n  text: Child execution receives a bounded PATH\n  commands: [node test.mjs]\n')
  const report = await checkProjectAsync(root)
  expect(report.status, JSON.stringify(report.criteria)).toBe('passed')
  expect(process.env.PATH).toBe(parent)
})
