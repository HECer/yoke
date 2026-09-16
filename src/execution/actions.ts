import { execFileSync } from 'node:child_process'
import { z } from 'zod'
import type { AgentRunner } from '../loop/runner.js'
import { NativeWorkspaceActionSchema, runNativeWorkspaceAction, type NativeActionAuthority } from '../control-plane/native-action.js'

const CommandActionSchema = z.object({
  storyId: z.string().min(1),
  file: z.string().min(1),
  args: z.array(z.string()).max(200).default([]),
  timeoutMs: z.number().int().min(1).max(600000).default(60000),
}).strict()
export const ToolActionSchema = z.union([CommandActionSchema, NativeWorkspaceActionSchema])
export type ToolAction = z.infer<typeof ToolActionSchema>

/** Explicit project-authored actions only; managed text edits never fall back to a shell/model. */
export function makeActionRunner(actions: ToolAction[], fallback: AgentRunner, authority?: NativeActionAuthority): AgentRunner {
  return context => {
    const action = actions.find(item => item.storyId === context.story.id)
    if (!action) return fallback(context)
    if ('kind' in action) {
      try {
        if (!authority) throw new Error('Managed edits need the existing loop lock and an owned isolated worktree')
        return runNativeWorkspaceAction(context, action, authority)
      } catch (error) { return { success: false, infrastructureFailure: true, summary: `Managed edit blocked: ${(error as Error).message}` } }
    }
    const tokens = { inputTokens: 0, outputTokens: 0, measurementComplete: true, totalCostUsd: 0, calls: [] }
    try {
      execFileSync(action.file, action.args, { cwd: context.targetDir, timeout: action.timeoutMs, shell: false, stdio: 'pipe', maxBuffer: 1024 * 1024 })
      return { success: true, summary: `Configured tool action ran: ${action.file}; acceptance still required`, tokens }
    } catch (error) {
      return { success: false, summary: `Configured tool action failed: ${(error as Error).message.slice(0, 2000)}`, tokens }
    }
  }
}
