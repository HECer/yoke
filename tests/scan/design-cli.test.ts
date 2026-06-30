import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runDesignScan } from '../../src/cli.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-dscli-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('runDesignScan', () => {
  it('exits 0 when the slop score is within --max', () => {
    writeFileSync(join(dir, 'a.css'), 'color: #6c5ce7;') // score 2
    expect(runDesignScan(dir, { max: 4, report: false })).toBe(0)
  })
  it('exits 1 when the slop score exceeds --max', () => {
    writeFileSync(join(dir, 'a.css'), 'color:#6c5ce7; box-shadow: 0 0 40px #0ff; background: linear-gradient(#fff,#000);') // 2+2+1 = 5
    expect(runDesignScan(dir, { max: 4, report: false })).toBe(1)
  })
  it('always exits 0 in --report mode even with findings', () => {
    writeFileSync(join(dir, 'a.css'), 'color:#6c5ce7; box-shadow: 0 0 40px #0ff;')
    expect(runDesignScan(dir, { max: 0, report: true })).toBe(0)
  })
  it('exits 0 on a clean project', () => {
    writeFileSync(join(dir, 'a.css'), 'color:#1d1d1f;')
    expect(runDesignScan(dir, { max: 4, report: false })).toBe(0)
  })
})
