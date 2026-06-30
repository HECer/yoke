import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

export interface Tell {
  name: string
  weight: number
  test: (line: string) => boolean
  hint: string
}
export interface Match { line: number; tell: Tell; text: string }
export interface Finding { file: string; line: number; tell: string; hint: string; text: string }
export interface ScanResult { findings: Finding[]; score: number }

const AI_PURPLE_HEX = /#(6c5ce7|7c3aed|8b5cf6|a855f7|9333ea)\b/i
const AI_PURPLE_TW = /\b(from|via|to)-(purple|violet|fuchsia)-(4|5|6|7)00\b/i
const NEON_TW = /\b(shadow|drop-shadow)-\[0_0_/i
const NEON_CSS = /box-shadow:[^;]*\b0\s+0\s+\d{2,}px/i
const EMOJI = /\p{Extended_Pictographic}/u
const JSX_ICON_CTX = /<button|<a\s|aria-hidden|(icon|emoji)/i

export const TELLS: Tell[] = [
  { name: 'ai-purple', weight: 2, hint: 'AI-purple is the #1 vibecoded tell — pick a real brand color',
    test: (l) => AI_PURPLE_HEX.test(l) || AI_PURPLE_TW.test(l) },
  { name: 'gradient-clip-text', weight: 2, hint: 'Gradient hero text reads as AI-slop — use a solid color + weight',
    test: (l) => (/bg-clip-text/.test(l) && /text-transparent/.test(l)) || /-webkit-background-clip:\s*text/i.test(l) },
  { name: 'neon-glow', weight: 2, hint: 'Neon glow is a tell — use subtle, neutral elevation',
    test: (l) => NEON_TW.test(l) || NEON_CSS.test(l) },
  { name: 'gradient-overload', weight: 1, hint: 'Gradients everywhere flatten hierarchy — use them sparingly',
    test: (l) => /bg-gradient-to-/.test(l) || /linear-gradient\(/i.test(l) },
  { name: 'emoji-icon', weight: 1, hint: 'Emoji-as-icons is a tell — use a real icon set',
    test: (l) => EMOJI.test(l) && JSX_ICON_CTX.test(l) },
]

// One match per (line, tell) at most, so a line with three purple classes counts once.
export function scanText(text: string, tells: Tell[] = TELLS): Match[] {
  const matches: Match[] = []
  const lines = text.split(/\r?\n/)
  lines.forEach((line, i) => {
    for (const tell of tells) {
      if (tell.test(line)) matches.push({ line: i + 1, tell, text: line.trim().slice(0, 200) })
    }
  })
  return matches
}

const EXT = new Set(['.css', '.scss', '.tsx', '.jsx', '.ts', '.js', '.html', '.vue', '.svelte', '.astro'])
const SKIP = new Set(['node_modules', 'dist', '.next', 'build', '.yoke', 'coverage', '.git', 'out'])

function walk(dir: string, acc: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    let s
    try { s = statSync(full) } catch { continue }
    if (s.isDirectory()) {
      if (!SKIP.has(entry)) walk(full, acc)
    } else if (EXT.has(extname(entry).toLowerCase())) {
      acc.push(full)
    }
  }
}

export function scanDir(dir: string, tells: Tell[] = TELLS): ScanResult {
  const files: string[] = []
  walk(dir, files)
  const findings: Finding[] = []
  let score = 0
  for (const file of files) {
    let text: string
    try { text = readFileSync(file, 'utf8') } catch { continue }
    for (const m of scanText(text, tells)) {
      findings.push({ file, line: m.line, tell: m.tell.name, hint: m.tell.hint, text: m.text })
      score += m.tell.weight
    }
  }
  return { findings, score }
}
