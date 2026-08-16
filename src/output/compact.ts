import type { CompactedOutput } from './types.js'

const OSC = /(?:\x1B\]|\u009D)[^\x07\x1B\u009C]*(?:\x07|\x1B\\|\u009C)/gu
const ANSI = /(?:\x1B\[|\u009B)[0-?]*[ -/]*[@-~]/gu
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/gu
const ERROR_SIGNAL = /(?:(?:^|[^A-Za-z0-9])error(?:[^A-Za-z0-9]|$)|\bfail(?:ed|ure)?\b|\bnot ok\b|\bassertionerror\b|\bfatal\b|\bpanic\b|\bexception\b|\btraceback\b|\bE\d{4}\b|\bTS\d{4}\b|(?:^|\s)[✗✘×](?:\s|$))/iu
const WARNING_SIGNAL = /(?:\bwarn(?:ing)?\b|\bdeprecat(?:ed|ion)\b)/iu
const SUMMARY_SIGNAL = /^\s*(?:Test Files|Tests?|Test Suites?|Suites?|Ran all test suites|Failures?|Passed|Failed)(?:\s|:|$)/iu

function cleanLine(line: string): string {
  return line.replace(OSC, '').replace(ANSI, '').replace(CONTROL, '').trimEnd()
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

const MAX_PRIORITY_CANDIDATES = 1_024
const MAX_DISTINCT_LINES = 4_096

interface IndexedLine {
  readonly index: number
  readonly line: string
}

interface LineScan {
  readonly originalLines: number
  readonly errorCandidates: readonly IndexedLine[]
  readonly warningCandidates: readonly IndexedLine[]
  readonly tail: readonly IndexedLine[]
  readonly fallback: readonly IndexedLine[]
  readonly firstSignal?: string
  readonly finalLine?: string
  readonly finalSummary?: string
  readonly distinctNonEmpty: ReadonlySet<string>
  readonly completePossible: boolean
}

function addCandidate(
  candidates: IndexedLine[],
  indexes: Set<number>,
  entry: IndexedLine | undefined,
): void {
  if (!entry || entry.line.trim() === '' || indexes.has(entry.index)) return
  if (candidates.length >= MAX_PRIORITY_CANDIDATES) return
  indexes.add(entry.index)
  candidates.push(entry)
}

function scanLines(raw: string, maxLineBytes: number): LineScan {
  const errorCandidates: IndexedLine[] = []
  const warningCandidates: IndexedLine[] = []
  const errorIndexes = new Set<number>()
  const warningIndexes = new Set<number>()
  const tail: IndexedLine[] = []
  const fallback: IndexedLine[] = []
  const distinctNonEmpty = new Set<string>()
  let distinctOverflow = false
  let clippedLine = false
  let previous: IndexedLine | undefined
  let pendingErrorContext = false
  let pendingWarningContext = false
  let firstError: string | undefined
  let firstWarning: string | undefined
  let firstNonEmpty: string | undefined
  let finalLine: string | undefined
  let finalSummary: string | undefined
  let index = 0
  let start = 0

  while (true) {
    const newline = raw.indexOf('\n', start)
    const end = newline === -1 ? raw.length : newline
    const cleaned = cleanLine(raw.slice(start, end))
    const cleanedBytes = Buffer.byteLength(cleaned)
    const line = cleanedBytes <= maxLineBytes ? cleaned : utf8Prefix(cleaned, maxLineBytes)
    if (line !== cleaned) clippedLine = true
    const current = { index, line }

    if (index < 2) fallback.push(current)
    tail.push(current)
    if (tail.length > 4) tail.shift()

    const nonEmpty = cleaned.trim() !== ''
    if (nonEmpty) {
      firstNonEmpty ??= line
      finalLine = line
      if (!distinctOverflow) {
        distinctNonEmpty.add(line)
        if (distinctNonEmpty.size > MAX_DISTINCT_LINES) {
          distinctOverflow = true
          distinctNonEmpty.clear()
        }
      }
    }
    if (SUMMARY_SIGNAL.test(cleaned)) finalSummary = line

    if (pendingErrorContext) addCandidate(errorCandidates, errorIndexes, current)
    if (pendingWarningContext) addCandidate(warningCandidates, warningIndexes, current)
    pendingErrorContext = false
    pendingWarningContext = false

    if (ERROR_SIGNAL.test(cleaned)) {
      firstError ??= line
      addCandidate(errorCandidates, errorIndexes, current)
      addCandidate(errorCandidates, errorIndexes, previous)
      pendingErrorContext = true
    }
    if (WARNING_SIGNAL.test(cleaned)) {
      firstWarning ??= line
      addCandidate(warningCandidates, warningIndexes, current)
      addCandidate(warningCandidates, warningIndexes, previous)
      pendingWarningContext = true
    }

    previous = current
    if (newline === -1) break
    index++
    start = newline + 1
  }

  return {
    originalLines: index + 1,
    errorCandidates,
    warningCandidates,
    tail,
    fallback,
    firstSignal: firstError ?? firstWarning ?? firstNonEmpty,
    ...(finalLine === undefined ? {} : { finalLine }),
    ...(finalSummary === undefined ? {} : { finalSummary }),
    distinctNonEmpty,
    completePossible: !distinctOverflow && !clippedLine,
  }
}

function uniqueCandidateLines(scan: LineScan): string[] {
  const seenIndexes = new Set<number>()
  const seenLines = new Set<string>()
  const selected: string[] = []
  const prioritized = [
    ...scan.errorCandidates,
    ...scan.warningCandidates,
    ...scan.tail,
    ...(scan.errorCandidates.length + scan.warningCandidates.length === 0 ? scan.fallback : []),
  ]
  for (const entry of prioritized) {
    if (entry.line.trim() === '' || seenIndexes.has(entry.index)) continue
    seenIndexes.add(entry.index)
    if (seenLines.has(entry.line)) continue
    seenLines.add(entry.line)
    selected.push(entry.line)
  }
  return selected
}

export function compactCommandOutput(raw: string, options: { readonly previewBytes: number }): CompactedOutput {
  const originalBytes = Buffer.byteLength(raw)
  if (raw === '') return { preview: '', originalBytes: 0, originalLines: 0, omitted: false }

  const scan = scanLines(raw, options.previewBytes)
  const originalLines = scan.originalLines
  const candidates = uniqueCandidateLines(scan)
  const complete = scan.completePossible && candidates.length >= scan.distinctNonEmpty.size
  const joined = candidates.join('\n')
  if (complete && Buffer.byteLength(joined) <= options.previewBytes) {
    return { preview: joined, originalBytes, originalLines, omitted: false }
  }

  const marker = `[… omitted; ${originalLines} lines, ${originalBytes} bytes total …]`
  const markerBytes = Buffer.byteLength(marker)
  const contentBudget = Math.max(0, options.previewBytes - markerBytes - 1)
  const selected: string[] = []
  let used = 0

  const essentials = [...new Set([scan.firstSignal, scan.finalSummary ?? scan.finalLine]
    .filter((line): line is string => Boolean(line)))]
  for (const [index, line] of essentials.entries()) {
    const separator = selected.length === 0 ? 0 : 1
    const remaining = essentials.length - index - 1
    const available = Math.max(0, contentBudget - used - separator - remaining)
    const lineBudget = remaining === 0 ? available : Math.floor(available / (remaining + 1))
    const value = utf8Prefix(line, lineBudget)
    if (!value) continue
    selected.push(value)
    used += separator + Buffer.byteLength(value)
  }

  for (const line of candidates) {
    if (essentials.includes(line)) continue
    const separator = selected.length === 0 ? 0 : 1
    const bytes = Buffer.byteLength(line)
    if (used + separator + bytes <= contentBudget) {
      selected.push(line)
      used += separator + bytes
      continue
    }
    if (selected.length === 0 && contentBudget > 0) {
      const truncated = utf8Prefix(line, contentBudget)
      selected.push(truncated)
      used = Buffer.byteLength(truncated)
      break
    }
  }
  const content = selected.filter(Boolean).join('\n')
  const preview = content
    ? `${content}\n${utf8Prefix(marker, options.previewBytes - Buffer.byteLength(content) - 1)}`
    : utf8Prefix(marker, options.previewBytes)
  return { preview, originalBytes, originalLines, omitted: true }
}
