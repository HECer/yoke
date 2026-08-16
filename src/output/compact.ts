import type { CompactedOutput } from './types.js'

const ANSI = /\x1B\[[0-?]*[ -/]*[@-~]/gu
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F]/gu
const ERROR_SIGNAL = /(?:(?:^|[^A-Za-z0-9])error(?:[^A-Za-z0-9]|$)|\bfailed?\b|\bfailure\b|\bfatal\b|\bpanic\b|\bexception\b|\btraceback\b|\bE\d{4}\b|\bTS\d{4}\b|(?:^|\s)[✗✘×](?:\s|$))/iu
const WARNING_SIGNAL = /(?:\bwarn(?:ing)?\b|\bdeprecat(?:ed|ion)\b)/iu

function cleanLine(line: string): string {
  return line.replace(ANSI, '').replace(CONTROL, '').trimEnd()
}

function utf8Prefix(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  let used = 0
  let result = ''
  for (const char of value) {
    const bytes = Buffer.byteLength(char)
    if (used + bytes > maxBytes) break
    result += char
    used += bytes
  }
  return result
}

function prioritizedIndexes(lines: readonly string[]): number[] {
  const indexes: number[] = []
  const seen = new Set<number>()
  const add = (index: number): void => {
    if (index < 0 || index >= lines.length || lines[index].trim() === '' || seen.has(index)) return
    seen.add(index)
    indexes.push(index)
  }
  const addMatches = (pattern: RegExp): number => {
    let matches = 0
    lines.forEach((line, index) => {
      if (!pattern.test(line)) return
      matches++
      add(index)
      add(index - 1)
      add(index + 1)
    })
    return matches
  }

  const errors = addMatches(ERROR_SIGNAL)
  const warnings = addMatches(WARNING_SIGNAL)
  for (let index = Math.max(0, lines.length - 4); index < lines.length; index++) add(index)
  if (errors + warnings === 0) {
    add(0)
    add(1)
  }
  return indexes
}

function uniqueCandidateLines(lines: readonly string[]): string[] {
  const seen = new Set<string>()
  const selected: string[] = []
  for (const index of prioritizedIndexes(lines)) {
    const line = lines[index]
    if (seen.has(line)) continue
    seen.add(line)
    selected.push(line)
  }
  return selected
}

export function compactCommandOutput(raw: string, options: { readonly previewBytes: number }): CompactedOutput {
  const originalBytes = Buffer.byteLength(raw)
  if (raw === '') return { preview: '', originalBytes: 0, originalLines: 0, omitted: false }

  const lines = raw.split(/\r?\n/u).map(cleanLine)
  const originalLines = lines.length
  const candidates = uniqueCandidateLines(lines)
  const distinctNonEmpty = new Set(lines.filter(line => line.trim() !== '')).size
  const complete = candidates.length >= distinctNonEmpty
  const joined = candidates.join('\n')
  if (complete && Buffer.byteLength(joined) <= options.previewBytes) {
    return { preview: joined, originalBytes, originalLines, omitted: false }
  }

  const marker = `[… omitted; ${originalLines} lines, ${originalBytes} bytes total …]`
  const markerBytes = Buffer.byteLength(marker)
  const contentBudget = Math.max(0, options.previewBytes - markerBytes - 1)
  const selected: string[] = []
  let used = 0
  for (const line of candidates) {
    const separator = selected.length === 0 ? 0 : 1
    const bytes = Buffer.byteLength(line)
    if (used + separator + bytes <= contentBudget) {
      selected.push(line)
      used += separator + bytes
      continue
    }
    if (selected.length === 0 && contentBudget > 0) selected.push(utf8Prefix(line, contentBudget))
  }
  const content = selected.filter(Boolean).join('\n')
  const preview = content
    ? `${content}\n${utf8Prefix(marker, options.previewBytes - Buffer.byteLength(content) - 1)}`
    : utf8Prefix(marker, options.previewBytes)
  return { preview, originalBytes, originalLines, omitted: true }
}
