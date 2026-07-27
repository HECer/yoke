import { readFileSync, writeFileSync } from 'node:fs'
import { parse, stringify } from 'yaml'
import { z } from 'zod'

export const StorySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  priority: z.number(),
  acceptance: z.array(z.string().min(1)),
  passes: z.boolean(),
  needs: z.array(z.string().min(1)).optional(),
  area: z.string().min(1).optional(),
  agent: z.enum(['claude', 'codex', 'gemini']).optional(),
})

export type Story = z.infer<typeof StorySchema>

const PrdSchema = z.array(StorySchema)

export function loadPrd(file: string): Story[] {
  const stories = PrdSchema.parse(parse(readFileSync(file, 'utf8')))
  const issues = validateDependencies(stories)
  if (issues.length) throw new Error(`Invalid PRD dependency graph:\n${issues.join('\n')}`)
  return stories
}

export function savePrd(file: string, stories: Story[]): void {
  writeFileSync(file, stringify(stories))
}

export function selectNextStory(stories: Story[]): Story | null {
  const passed = new Set(stories.filter(s => s.passes).map(s => s.id))
  const open = stories.filter(s => !s.passes && (s.needs ?? []).every(id => passed.has(id)))
  if (open.length === 0) return null
  return open.reduce((best, s) => (s.priority < best.priority ? s : best))
}

export function validateDependencies(stories: Story[]): string[] {
  const issues: string[] = []
  const counts = new Map<string, number>()
  for (const story of stories) counts.set(story.id, (counts.get(story.id) ?? 0) + 1)
  for (const [id, count] of counts) if (count > 1) issues.push(`duplicate story id: ${id}`)
  const ids = new Set(stories.map(s => s.id))
  for (const story of stories) {
    for (const need of story.needs ?? []) {
      if (need === story.id) issues.push(`story ${story.id} depends on itself`)
      else if (!ids.has(need)) issues.push(`story ${story.id} has unknown dependency ${need}`)
    }
  }
  const byId = new Map(stories.map(s => [s.id, s]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const walk = (id: string, path: string[]) => {
    if (visiting.has(id)) { issues.push(`dependency cycle: ${[...path, id].join(' -> ')}`); return }
    if (visited.has(id)) return
    visiting.add(id)
    for (const need of byId.get(id)?.needs ?? []) if (byId.has(need) && need !== id) walk(need, [...path, id])
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of byId.keys()) walk(id, [])
  return [...new Set(issues)]
}

export function allPass(stories: Story[]): boolean {
  return stories.length > 0 && stories.every(s => s.passes)
}

export function progress(stories: Story[]): { passed: number; total: number } {
  return { passed: stories.filter(s => s.passes).length, total: stories.length }
}
