import { randomUUID } from 'node:crypto'
import { linkSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type ProviderProcessRecord = {
  readonly path: string
  readonly version: 1
  readonly owner: 'provider-process'
  readonly targetDir: string
  readonly childPid: number
  readonly startedAt: string
  readonly workerId?: string
}

export type ProviderProcessRecordData = {
  readonly version: 1
  readonly owner: 'provider-process'
  readonly targetDir: string
  readonly childPid: number
  readonly startedAt: string
  readonly workerId?: string
}

export interface ProviderProcessRecordAdapter {
  publish(record: ProviderProcessRecord): void
  remove(path: string): void
}

export function createProviderProcessRecord(targetDir: string, childPid: number, workerId: string | undefined, startedAt: string = new Date().toISOString()): ProviderProcessRecord {
  const worker = workerId?.replace(/[^A-Za-z0-9_-]/gu, '_') || 'call'
  return {
    path: join(targetDir, '.yoke', 'provider-processes', `${worker}-${randomUUID()}.json`),
    version: 1,
    owner: 'provider-process',
    targetDir,
    childPid,
    startedAt,
    ...(workerId ? { workerId } : {}),
  }
}

export const filesystemProviderProcessRecordAdapter: ProviderProcessRecordAdapter = {
  publish(record): void {
    const directory = join(record.targetDir, '.yoke', 'provider-processes')
    mkdirSync(directory, { recursive: true })
    const temporary = `${record.path}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify({
      version: record.version,
      owner: record.owner,
      targetDir: record.targetDir,
      childPid: record.childPid,
      startedAt: record.startedAt,
      ...(record.workerId ? { workerId: record.workerId } : {}),
    }), { flag: 'wx' })
    try {
      linkSync(temporary, record.path)
    } finally {
      rmSync(temporary, { force: true })
    }
  },
  remove(path): void {
    rmSync(path, { force: true })
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseProviderProcessRecord(value: unknown): ProviderProcessRecordData | null {
  if (!isRecord(value)) return null
  const workerId = value.workerId
  if (
    value.version !== 1 ||
    value.owner !== 'provider-process' ||
    typeof value.targetDir !== 'string' ||
    typeof value.childPid !== 'number' ||
    !Number.isInteger(value.childPid) ||
    value.childPid <= 0 ||
    typeof value.startedAt !== 'string' ||
    value.startedAt.length === 0 ||
    (workerId !== undefined && typeof workerId !== 'string')
  ) return null
  return {
    version: 1,
    owner: 'provider-process',
    targetDir: value.targetDir,
    childPid: value.childPid,
    startedAt: value.startedAt,
    ...(typeof workerId === 'string' ? { workerId } : {}),
  }
}
