import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { enumerateSkillPackage } from '../../src/canon/skill-package.js'

let canonDir: string

function write(relativePath: string, content: string | Uint8Array): void {
  const target = join(canonDir, relativePath)
  mkdirSync(join(target, '..'), { recursive: true })
  writeFileSync(target, content)
}

beforeEach(() => {
  canonDir = mkdtempSync(join(tmpdir(), 'yoke-skill-package-'))
})

afterEach(() => {
  rmSync(canonDir, { recursive: true, force: true })
})

describe('enumerateSkillPackage', () => {
  it('returns every regular package file in stable relative-path order', () => {
    write('skills/example/references/guide.md', '# Guide')
    write('skills/example/SKILL.md', '---\nname: example\ndescription: Example\n---\n')
    write('skills/example/assets/sample.bin', new Uint8Array([0, 255, 4]))

    const files = enumerateSkillPackage(canonDir, {
      id: 'example',
      path: 'skills/example',
      kind: 'methodology',
      invocation: 'auto',
    })

    expect(files.map(file => file.relativePath)).toEqual([
      'SKILL.md',
      'assets/sample.bin',
      'references/guide.md',
    ])
    expect([...files[1]!.content]).toEqual([0, 255, 4])
  })

  it.runIf(process.platform !== 'win32' || process.env.YOKE_INCLUDE_PLATFORM_TESTS === '1')('records executable intent', () => {
    write('skills/example/SKILL.md', '---\nname: example\ndescription: Example\n---\n')
    write('skills/example/scripts/check.sh', '#!/bin/sh\n')
    chmodSync(join(canonDir, 'skills/example/scripts/check.sh'), 0o755)

    const files = enumerateSkillPackage(canonDir, {
      id: 'example', path: 'skills/example', kind: 'methodology', invocation: 'auto',
    })

    expect(files.find(file => file.relativePath === 'scripts/check.sh')?.executable).toBe(true)
  })

  it('rejects a package path that escapes the Canon directory', () => {
    write('outside/SKILL.md', '---\nname: outside\ndescription: Outside\n---\n')

    expect(() => enumerateSkillPackage(canonDir, {
      id: 'outside', path: '../outside', kind: 'methodology', invocation: 'auto',
    })).toThrow(/escapes Canon directory/u)
  })

  it('rejects symbolic links instead of following them', () => {
    write('skills/example/SKILL.md', '---\nname: example\ndescription: Example\n---\n')
    const link = join(canonDir, 'skills/example/copied.md')
    try {
      symlinkSync(join(canonDir, 'skills/example/SKILL.md'), link, 'file')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return
      throw error
    }

    expect(() => enumerateSkillPackage(canonDir, {
      id: 'example', path: 'skills/example', kind: 'methodology', invocation: 'auto',
    })).toThrow(/symbolic link/u)
  })
})
