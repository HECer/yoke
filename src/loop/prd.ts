import { readFileSync, writeFileSync } from 'node:fs'
import { parse, stringify } from 'yaml'
import { z } from 'zod'

export const StorySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  priority: z.number(),
  acceptance: z.array(z.string().min(1)),
  passes: z.boolean(),
})

export type Story = z.infer<typeof StorySchema>

const PrdSchema = z.array(StorySchema)

export function loadPrd(file: string): Story[] {
  return PrdSchema.parse(parse(readFileSync(file, 'utf8')))
}

export function savePrd(file: string, stories: Story[]): void {
  writeFileSync(file, stringify(stories))
}

export function selectNextStory(stories: Story[]): Story | null {
  const open = stories.filter(s => !s.passes)
  if (open.length === 0) return null
  return open.reduce((best, s) => (s.priority < best.priority ? s : best))
}

export function allPass(stories: Story[]): boolean {
  return stories.length > 0 && stories.every(s => s.passes)
}

export function progress(stories: Story[]): { passed: number; total: number } {
  return { passed: stories.filter(s => s.passes).length, total: stories.length }
}
