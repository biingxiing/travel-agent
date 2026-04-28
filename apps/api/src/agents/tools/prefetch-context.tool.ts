// apps/api/src/agents/tools/prefetch-context.tool.ts
import type { SubagentTool, SubagentResult, EmitFn } from './types.js'
import type { SessionState, TripBrief } from '@travel-agent/shared'
import { prefetchFlyaiContext } from '../prefetch.js'

export const prefetchContextTool: SubagentTool = {
  name: 'call_prefetch',
  description: 'Fetch real-world flight, train, hotel, and POI data for the current TripBrief. Reads from session state automatically — you may pass `brief` to override. Always call `call_extractor` first so the brief is populated. The fetched data is stored in the session and consumed by call_generator. On continuation turns, only call again if intent is "new"; otherwise reuse the already-fetched context.',
  parametersSchema: {
    type: 'object',
    properties: {
      brief: {
        type: 'object',
        description: 'Optional TripBrief override. If omitted, the tool reads session.brief.',
      },
    },
    required: [],
    additionalProperties: false,
  },
  isConcurrencySafe: () => true,
  async call(input, session: SessionState, emit: EmitFn): Promise<SubagentResult> {
    await emit({ type: 'agent_step', agent: 'prefetch', status: 'thinking' })
    const brief = (input as { brief?: TripBrief }).brief ?? session.brief ?? undefined
    if (!brief || !brief.destinations || brief.destinations.length === 0) {
      const message = 'No destinations in session brief — call call_extractor first or ask the user for a destination via call_clarifier.'
      await emit({
        type: 'agent_step',
        agent: 'prefetch',
        status: 'done',
        output: message,
      })
      return { type: 'ok', output: message }
    }
    const context = await prefetchFlyaiContext(brief, session.id)
    session.prefetchContext = context
    await emit({
      type: 'agent_step',
      agent: 'prefetch',
      status: 'done',
      output: `${context.length} context entries fetched`,
    })
    return {
      type: 'ok',
      output: `Prefetched ${context.length} context entries. Use session.prefetchContext when calling call_generator.`,
    }
  },
}
