import { createHash } from 'node:crypto'

/** Git may convert CRLF pairs; preserve every other byte, including lone CR. */
export function normalizePlanningBytes(source: string | Buffer): Buffer {
  const bytes = typeof source === 'string' ? Buffer.from(source, 'utf8') : source
  return Buffer.from(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1')
}

export function planningSourceDigest(source: string | Buffer): string {
  return createHash('sha256').update(normalizePlanningBytes(source)).digest('hex')
}
