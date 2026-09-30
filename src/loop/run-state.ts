import { randomUUID } from 'node:crypto'
import { lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import { statePath } from '../workspace/state.js'
import { readLock } from './lock.js'
import type { RunLoopCommandOptions } from './run-command.js'
import { AgentSchema, ModelSelectionSchema } from '../agents/contracts.js'
import type { LoopReporter } from './reporter.js'

const agent = AgentSchema
const bounded = z.number().int().min(1).max(1_000_000)
const selection = ModelSelectionSchema.omit({ nativeMultiAgent: true }).strict()
const Options = z.object({
  agent: agent.optional(), reviewer: agent.optional(), maxIterations: bounded.optional(), isolate: z.boolean().optional(),
  resumeWorktree: z.boolean().optional(), review: z.boolean().optional(), timeoutMinutes: z.number().finite().min(0).max(10080).optional(),
  json: z.boolean().optional(), onAmbiguity: z.enum(['resolve', 'abort', 'auto', 'critical']).optional(), decisionPolicy: z.enum(['auto', 'critical']).optional(),
  parallel: z.number().int().min(1).max(64).optional(), parallelAuto: z.boolean().optional(), routing: z.boolean().optional(),
  quality: z.boolean().optional(), qualityRounds: bounded.optional(), qualityMinutes: z.number().finite().positive().max(10080).optional(),
  qualityPolicy: z.enum(['blocking', 'advisory']).optional(), candidates: z.number().int().min(1).max(5).optional(),
  exploreIntervalMinutes: z.number().int().min(1).max(1440).optional(), selection: selection.optional(), native: z.boolean().optional(),
  explorationPlanner: z.object({ agent, selection }).strict().optional(),
}).strict()
const State = z.object({ version: z.literal(1), runId: z.string().uuid(), startedAt: z.string().datetime(), mode: z.enum(['loop', 'explore', 'goal']), goalId: z.string().uuid().optional(), consumedIterations: z.number().int().min(0).max(1_000_000_000).optional(), exploreDeadline: z.number().int().min(0).max(8_640_000_000_000_000).optional(), options: Options }).strict().superRefine((run, ctx) => {
  if ((run.mode === 'goal') !== Boolean(run.goalId)) ctx.addIssue({ code: 'custom', message: 'Run goal identity does not match mode' })
  if (run.mode !== 'explore' && run.exploreDeadline !== undefined) ctx.addIssue({ code: 'custom', message: 'Exploration deadline does not match mode' })
})
export type SavedRunState = z.infer<typeof State>
export type SavedRunOptions = z.infer<typeof Options>

function safeOptions(options: object): SavedRunOptions {
  const selected: Record<string, unknown> = {}
  for (const key of Object.keys(Options.shape)) {
    const value = (options as Record<string, unknown>)[key]
    if (value !== undefined) {
      if (key === 'selection') {
        const { nativeMultiAgent: _native, ...model } = ModelSelectionSchema.parse(value)
        selected[key] = selection.parse(model)
      } else if (key === 'explorationPlanner') {
        const planner = value as { agent: unknown; selection: unknown }
        const { nativeMultiAgent: _native, ...model } = ModelSelectionSchema.parse(planner.selection)
        selected[key] = { agent: planner.agent, selection: selection.parse(model) }
      } else selected[key] = value
    }
  }
  return Options.parse(selected)
}
export function createLoopRun(options: RunLoopCommandOptions, now = Date.now()): SavedRunState {
  const deadline = options.exploreLimitMs === undefined ? undefined : now + options.exploreLimitMs
  return State.parse({ version: 1, runId: randomUUID(), startedAt: new Date(now).toISOString(), mode: options.explore ? 'explore' : 'loop', options: safeOptions(options), ...(deadline !== undefined ? { exploreDeadline: deadline } : {}) })
}
export function readRunState(root: string): SavedRunState | null {
  const file = statePath(root, 'run-state.json')
  try {
    const stat = lstatSync(file)
    if (!stat.isFile()) throw new Error('Saved run is not a file')
    if (stat.size > 65536) throw new Error('Saved run is too large')
    return State.parse(JSON.parse(readFileSync(file, 'utf8')))
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}
export function writeRunState(root: string, run: SavedRunState, ownerToken: string | undefined): void {
  const validated = State.parse(run)
  statePath(root, 'loop.lock')
  if (!ownerToken || readLock(root)?.ownerToken !== ownerToken) throw new Error('Saving run requires ownership of the loop lock')
  const file = statePath(root, 'run-state.json')
  const temp = statePath(root, `run-state.${randomUUID()}.tmp`)
  try { writeFileSync(temp, JSON.stringify(validated), { flag: 'wx', mode: 0o600 }); statePath(root, 'run-state.json'); renameSync(temp, file) }
  finally { rmSync(temp, { force: true }) }
}
export function recordGoalRun(root: string, goalId: string, ownerToken: string | undefined, options: object = {}): void {
  const values = options as Record<string, unknown>
  let previous: SavedRunState | null = null
  try { previous = readRunState(root) } catch { /* an explicitly started goal may replace invalid old execution metadata */ }
  const sameGoal = previous?.mode === 'goal' && previous.goalId === goalId ? previous : null
  writeRunState(root, State.parse({ version: 1, runId: sameGoal?.runId ?? randomUUID(), startedAt: sameGoal?.startedAt ?? new Date().toISOString(), mode: 'goal', goalId, options: safeOptions({ ...values, agent: values.agent ?? values.provider }) }), ownerToken)
}

/** Charge each dispatch before its reporter callback can begin provider work. */
export function accountRunIterations(root: string, run: SavedRunState, ownerToken: string | undefined, reporter: LoopReporter): LoopReporter {
  const previousIterations = run.consumedIterations ?? 0
  let charged = 0
  const account = (iteration: number | undefined): void => {
    if (iteration === undefined || !Number.isSafeInteger(iteration) || iteration <= charged) return
    const current = readRunState(root)
    if (current?.runId !== run.runId) throw new Error('Execution identity changed before dispatch')
    run.consumedIterations = previousIterations + iteration
    writeRunState(root, run, ownerToken)
    charged = iteration
  }
  return new Proxy(reporter, {
    get(target, key) {
      if (key === 'storyStart') return (...args: Parameters<LoopReporter['storyStart']>) => { account(args[1]); target.storyStart(...args) }
      if (key === 'parallel') return (status: Parameters<NonNullable<LoopReporter['parallel']>>[0]) => { account(status.iteration); target.parallel?.(status) }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
