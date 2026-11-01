import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Agent } from '../retrofit/config.js'
import type { ModelSelection } from '../agents/types.js'
import { buildProviderInvocation } from '../agents/providers.js'

export function qualityCriticInvocation(agent: Agent, prompt: string, cwd: string, selection: ModelSelection, schema: Record<string, unknown>) {
  const schemaFile = 'decision.schema.json'
  if (agent === 'codex') writeFileSync(join(cwd, schemaFile), JSON.stringify(schema), { mode: 0o600 })
  // Claude's current Windows shim cannot pass inline JSON safely. Every provider
  // also receives the complete schema in its prompt and has its result validated.
  const output = agent === 'codex' ? { schemaFile } : agent === 'claude' && process.platform !== 'win32' ? { jsonSchema: schema } : {}
  const invocation = buildProviderInvocation(agent, prompt, cwd, 'read-only', { ...selection, nativeMultiAgent: false }, output)
  return agent === 'codex' ? { ...invocation, args: [...invocation.args, '--skip-git-repo-check'] } : invocation
}
