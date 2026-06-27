import { z } from 'zod'
import { parse } from 'yaml'
import { readFileSync } from 'node:fs'

export const AgentSchema = z.enum(['claude', 'codex', 'gemini'])

export const SkillEntrySchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  kind: z.enum(['methodology', 'role']),
})

export const ToolEntrySchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
})

export const ManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  agents: z.array(AgentSchema).min(1),
  skills: z.array(SkillEntrySchema),
  policy: z.array(z.object({ path: z.string().min(1) })),
  loop: z.object({ spec: z.string().min(1), prdSchema: z.string().min(1) }),
  tools: z.array(ToolEntrySchema),
})

export type Manifest = z.infer<typeof ManifestSchema>

export function loadManifest(file: string): Manifest {
  const raw = parse(readFileSync(file, 'utf8'))
  return ManifestSchema.parse(raw)
}
