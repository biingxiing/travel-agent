// apps/api/src/agents/tools/prefetch-context.tool.ts
import type { SubagentTool, SubagentResult, EmitFn } from './types.js'
import type { SessionState, TripBrief } from '@travel-agent/shared'
import { prefetchFlyaiContext } from '../prefetch.js'

export const prefetchContextTool: SubagentTool = {
  name: 'call_prefetch',
  description: 'Fetch real-world flight, hotel, and POI data for the given TripBrief. Returns a summary of how many context entries were fetched. Pass session.prefetchContext when calling call_generator.',
  parametersSchema: {
    type: 'object',
    properties: {
      brief: {
        type: 'object',
        description: 'The TripBrief JSON object returned by call_extractor.',
      },
    },
    required: ['brief'],
    additionalProperties: false,
  },
  isConcurrencySafe: () => true,
  async call(input, session: SessionState, emit: EmitFn): Promise<SubagentResult> {
    await emit({ type: 'agent_step', agent: 'prefetch', status: 'thinking' })
    const { brief } = input as { brief: TripBrief }
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
