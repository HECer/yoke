import { parse } from 'yaml'

export function parseFrontmatter(content: string): Record<string, unknown> | null {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return null
  const parsed = parse(m[1])
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
}
