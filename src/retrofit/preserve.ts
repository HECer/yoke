export const PRESERVE_START = '<!-- yoke:preserve:start -->'
export const PRESERVE_END = '<!-- yoke:preserve:end -->'

export const PRESERVE_SCAFFOLD = `${PRESERVE_START}
<!-- Project-specific instructions go here. Yoke keeps this block across retrofits. -->
${PRESERVE_END}`

/**
 * Extract the inner content of every balanced preserve-marker pair, in order.
 * An unbalanced start marker (no matching end) is ignored from that point on.
 */
export function extractPreserveBlocks(content: string): string[] {
  const blocks: string[] = []
  let idx = 0
  for (;;) {
    const start = content.indexOf(PRESERVE_START, idx)
    if (start === -1) break
    const innerStart = start + PRESERVE_START.length
    const end = content.indexOf(PRESERVE_END, innerStart)
    if (end === -1) break
    blocks.push(
      content
        .slice(innerStart, end)
        .replace(/^\r?\n/, '')
        .replace(/\r?\n[ \t]*$/, ''),
    )
    idx = end + PRESERVE_END.length
  }
  return blocks
}

/**
 * Carry the preserve blocks of `current` (the file on disk) into `incoming`
 * (the freshly generated content).
 *
 * - `current` has no blocks → `incoming` is returned unchanged.
 * - `incoming` has a marker pair (the scaffold) → its inner is replaced with
 *   the preserved content (multiple blocks joined by a blank line).
 * - `incoming` has no markers → one preserved block is appended at the end.
 */
export function carryPreserved(current: string, incoming: string): string {
  const blocks = extractPreserveBlocks(current)
  if (blocks.length === 0) return incoming
  const inner = blocks.join('\n\n')

  const start = incoming.indexOf(PRESERVE_START)
  const end = start === -1 ? -1 : incoming.indexOf(PRESERVE_END, start + PRESERVE_START.length)
  if (start !== -1 && end !== -1) {
    return (
      incoming.slice(0, start + PRESERVE_START.length) +
      '\n' + inner + '\n' +
      incoming.slice(end)
    )
  }
  return incoming.replace(/\n*$/, '\n\n') + `${PRESERVE_START}\n${inner}\n${PRESERVE_END}\n`
}
