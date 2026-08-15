import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createProviderProcessRecord, filesystemProviderProcessRecordAdapter } from '../../src/agents/process-record.js'

const tempDirs: string[] = []

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yoke-process-record-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('filesystemProviderProcessRecordAdapter', () => {
  it('fails without replacing an existing provider record', () => {
    // Given: an existing record at the generated target path.
    const record = createProviderProcessRecord(tempProject(), 123, 'worker')
    mkdirSync(dirname(record.path), { recursive: true })
    writeFileSync(record.path, 'foreign-record')

    // When: a second publication attempts the same path.
    expect(() => filesystemProviderProcessRecordAdapter.publish(record)).toThrow()

    // Then: the foreign record remains unchanged and no temporary record is retained.
    expect(readFileSync(record.path, 'utf8')).toBe('foreign-record')
    expect(readdirSync(dirname(record.path))).toEqual([basename(record.path)])
  })
})
