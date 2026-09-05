import { execFileSync } from 'node:child_process'
import { z } from 'zod'
import type { AgentRunner } from '../loop/runner.js'

export const ToolActionSchema = z.object({
  storyId: z.string().min(1),
  file: z.string().min(1),
  args: z.array(z.string()).max(200).default([]),
  timeoutMs: z.number().int().min(1).max(600000).default(60000),
}).strict()
export type ToolAction = z.infer<typeof ToolActionSchema>

/** Project-authored argv only: no free-form model-produced command, no shell. */
export function makeActionRunner(actions: ToolAction[], fallback: AgentRunner): AgentRunner {
  return context => {
    const action = actions.find(item => item.storyId === context.story.id)
    if (!action) return fallback(context)
    const tokens = { inputTokens: 0, outputTokens: 0, measurementComplete: true, totalCostUsd: 0, calls: [] }
    try {
      execFileSync(action.file, action.args, { cwd: context.targetDir, timeout: action.timeoutMs, shell: false, stdio: 'pipe', maxBuffer: 1024 * 1024 })
      return { success: true, summary: `Configured tool action ran: ${action.file}; acceptance still required`, tokens }
    } catch (error) {
      return { success: false, summary: `Configured tool action failed: ${(error as Error).message.slice(0, 2000)}`, tokens }
    }
  }
}
