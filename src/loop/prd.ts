import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import { StoryQualityDeclarationSchema } from '../quality/types.js'

export const AcceptanceCriterionSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  text: z.string().min(1),
  verify: z.array(z.string().min(1)).min(1),
})

export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>

export function criterionCommandProblem(criterion: AcceptanceCriterion): string | null {
  const normalizedId = criterion.id.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const raw of criterion.verify) {
    const command = raw.trim()
    if (/(?:[&;|<>`\r\n]|\$\()/.test(command)) {
      return `criterion ${criterion.id} must use one single test command without shell control operators`
    }
    const isTestCommand = /^(?:(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+(?:test|check|verify)(?::[A-Za-z0-9._-]+)?|npx\s+(?:vitest|jest|playwright|cypress)|(?:vitest|jest|pytest|phpunit)|python\s+-m\s+pytest|cargo\s+test|go\s+test|dotnet\s+test|mvn(?:w)?\s+test|gradle(?:w)?\s+test|bundle\s+exec\s+(?:rspec|rails\s+test)|bin\/rails\s+test|vendor\/bin\/phpunit|mix\s+test|swift\s+test|xcodebuild\s+test)(?:\s|$)/i.test(command)
    if (!isTestCommand) return `criterion ${criterion.id} must use an approved test command`
    const normalizedCommand = command.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!normalizedCommand.includes(normalizedId)) {
      return `criterion ${criterion.id} must target its criterion id in every verify command`
    }
  }
  return null
}

export const StorySchema = z.object({
  // Existing projects may already use human-readable IDs. Keep loading them;
  // every filesystem use goes through storyPathSegment instead.
  id: z.string().min(1),
  title: z.string().min(1),
  priority: z.number(),
  // String criteria remain readable for existing projects. New strict projects
  // use structured criteria so Yoke can execute proof for each outcome instead
  // of trusting an unrelated green test suite.
  acceptance: z.array(z.union([z.string().min(1), AcceptanceCriterionSchema])),
  passes: z.boolean(),
  needs: z.array(z.string().min(1)).optional(),
  area: z.string().min(1).optional(),
  agent: z.enum(['claude', 'codex', 'gemini']).optional(),
  /** Inbox request that created this story. Used for idempotent append-only intake. */
  sourceChange: z.string().min(1).optional(),
  quality: StoryQualityDeclarationSchema.optional(),
}).superRefine((story, ctx) => {
  const structured = story.acceptance.filter(isAcceptanceCriterion)
  const ids = structured.map(criterion => criterion.id)
  if (structured.length > 0 && (structured.length < 2 || structured.length > 5)) {
    ctx.addIssue({
      code: 'custom',
      path: ['acceptance'],
      message: 'structured stories must have 2-5 structured acceptance criteria',
    })
  }
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['acceptance'],
      message: 'structured criterion ids must be unique within a story',
    })
  }
})

export type Story = z.infer<typeof StorySchema>

export function storyPathSegment(id: string): string {
  return `story-${createHash('sha256').update(id, 'utf8').digest('hex')}`
}

export function isAcceptanceCriterion(value: Story['acceptance'][number]): value is AcceptanceCriterion {
  return typeof value !== 'string'
}

export function acceptanceText(value: Story['acceptance'][number]): string {
  return typeof value === 'string' ? value : value.text
}

const PrdSchema = z.array(StorySchema)

export function parsePrd(file: string): Story[] {
  return PrdSchema.parse(parse(readFileSync(file, 'utf8')))
}

export function loadPrd(file: string): Story[] {
  const stories = parsePrd(file)
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
