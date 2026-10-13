/** Byte-bounded output storage. Appending copies only new bytes, not the retained log. */
export interface BoundedOutput {
  append(text: string): void
  readonly text: string
  readonly truncated: boolean
}

export const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

export function validateOutputLimit(limitBytes: number): void {
  if (!Number.isSafeInteger(limitBytes) || limitBytes < 0 || limitBytes > MAX_OUTPUT_BYTES) {
    throw new RangeError(`Output limit must be an integer between 0 and ${MAX_OUTPUT_BYTES} bytes`)
  }
}

export function createBoundedOutput(limitBytes: number): BoundedOutput {
  validateOutputLimit(limitBytes)
  let buffer: Buffer | undefined
  let length = 0
  let cursor = 0
  let truncated = false
  let cached = ''
  let dirty = false
  return {
    append(text): void {
      if (!text) return
      dirty = true
      if (limitBytes === 0) { truncated = true; return }
      const bytes = Buffer.from(text, 'utf8')
      buffer ??= Buffer.allocUnsafe(limitBytes)
      truncated ||= length + bytes.length > limitBytes
      if (bytes.length >= limitBytes) {
        bytes.copy(buffer, 0, bytes.length - limitBytes)
        length = limitBytes
        cursor = 0
        return
      }
      const first = Math.min(bytes.length, limitBytes - cursor)
      bytes.copy(buffer, cursor, 0, first)
      if (first < bytes.length) bytes.copy(buffer, 0, first)
      cursor = (cursor + bytes.length) % limitBytes
      length = Math.min(limitBytes, length + bytes.length)
    },
    get text(): string {
      if (!dirty) return cached
      dirty = false
      if (!buffer || !length) return (cached = '')
      const bytes = length < limitBytes ? buffer.subarray(0, length)
        : cursor === 0 ? buffer : Buffer.concat([buffer.subarray(cursor), buffer.subarray(0, cursor)], length)
      // Tail retention can start inside a UTF-8 character. Never invent U+FFFD
      // or exceed the byte budget by decoding an orphan continuation byte.
      let start = 0
      while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++
      return (cached = bytes.subarray(start).toString('utf8'))
    },
    get truncated(): boolean { return truncated },
  }
}

export const DEFAULT_TELEMETRY_LINE_BYTES = 8 * 1024 * 1024

/** Bounded NDJSON framing. An oversized frame is discarded through its newline,
 * never parsed as a suffix. Fragment coalescing avoids quadratic concatenation.
 */
export function createLineFramer(consume: (line: string) => void, onDiscard: () => void, limitBytes = DEFAULT_TELEMETRY_LINE_BYTES) {
  if (!Number.isSafeInteger(limitBytes) || limitBytes < 1 || limitBytes > MAX_OUTPUT_BYTES) {
    throw new RangeError(`Telemetry line limit must be an integer between 1 and ${MAX_OUTPUT_BYTES} bytes`)
  }
  let fragments: string[] = []
  let pending = ''
  let bytes = 0
  let discarding = false
  const add = (part: string): void => {
    if (discarding || !part) return
    bytes += Buffer.byteLength(part, 'utf8')
    if (bytes > limitBytes) {
      fragments = []; pending = ''; bytes = 0; discarding = true
      onDiscard()
      return
    }
    pending += part
    if (pending.length >= 8192) { fragments.push(pending); pending = '' }
  }
  const flush = (): void => {
    let line: string | undefined
    if (!discarding && bytes) {
      line = fragments.length ? fragments.join('') + pending : pending
    }
    fragments = []; pending = ''; bytes = 0; discarding = false
    // Release ownership before invoking caller code, including reentrant finish.
    if (line !== undefined) consume(line.endsWith('\r') ? line.slice(0, -1) : line)
  }
  return {
    append(text: string): void {
      let start = 0
      while (start < text.length) {
        const end = text.indexOf('\n', start)
        if (end === -1) { add(text.slice(start)); break }
        add(text.slice(start, end)); flush(); start = end + 1
      }
    },
    finish(): void { flush() },
    get retainedBytes(): number { return bytes },
  }
}
