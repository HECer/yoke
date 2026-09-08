import type { Agent, YokeConfig } from '../retrofit/config.js'
import type { ModelSelection } from '../agents/types.js'

/** Planning settings never replace the execution model or provider. */
export function resolvePlanner(config: Pick<YokeConfig, 'planning'> | null, start: Agent, selection: ModelSelection = {}, override?: Agent): { agent: Agent; selection: ModelSelection } {
  const agent = override ?? config?.planning?.agent ?? start
  const inherited = agent === start ? selection : {}
  const planning = !override || override === (config?.planning?.agent ?? start) ? config?.planning : undefined
  return { agent, selection: {
    provider: planning?.provider ?? inherited.provider,
    model: planning?.model ?? inherited.model,
    reasoningEffort: planning?.reasoningEffort ?? inherited.reasoningEffort,
    variant: planning?.variant ?? inherited.variant,
    bare: inherited.bare,
    nativeMultiAgent: false,
  } }
}
