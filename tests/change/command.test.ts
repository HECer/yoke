import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../../src/cli.js'
import { pendingChanges } from '../../src/change/inbox.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yoke-change-command-'))
  mkdirSync(join(dir, '.yoke'), { recursive: true })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('yoke change', () => {
  it('is discoverable from the top-level CLI usage', () => {
    const lines: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation(value => { lines.push(String(value)) })
    try {
      expect(main([])).toBe(0)
    } finally { log.mockRestore() }
    expect(lines.join('\n')).toContain('change <add|status>')
  })

  it('accepts a new request without needing a running planner', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      expect(main(['change', 'add', dir, '--idea=Add passkeys'])).toBe(0)
    } finally { log.mockRestore() }
    expect(pendingChanges(dir)).toMatchObject([{ request: 'Add passkeys' }])
  })

  it('rejects an empty request', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(main(['change', 'add', dir])).toBe(1)
    } finally { error.mockRestore() }
  })

  it('reports an empty inbox and multiple pending requests', () => {
    const lines: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation(value => { lines.push(String(value)) })
    try {
      expect(main(['change', 'status', dir])).toBe(0)
      expect(lines.pop()).toBe('No pending changes.')
      expect(main(['change', 'add', dir, '--idea=Add passkeys'])).toBe(0)
      expect(main(['change', 'add', dir, '--idea=Add recovery codes'])).toBe(0)
      expect(main(['change', 'status', dir])).toBe(0)
    } finally { log.mockRestore() }
    const status = lines[lines.length - 1]
    expect(status).toContain('Add passkeys')
    expect(status).toContain('Add recovery codes')
  })

  it('fails closed on a malformed inbox entry', () => {
    const pending = join(dir, '.yoke', 'changes', 'pending')
    mkdirSync(pending, { recursive: true })
    writeFileSync(join(pending, 'broken.json'), '{broken')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(main(['change', 'status', dir])).toBe(1)
    } finally { error.mockRestore() }
  })
})
