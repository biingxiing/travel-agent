// apps/api/src/agents/tools/generate-plan.tool.ts
import type { SubagentTool, SubagentResult, EmitFn } from './types.js'
import type { SessionState, TripBrief, ChatStreamEvent } from '@travel-agent/shared'
import { runInitial } from '../generator.js'

export const generatePlanTool: SubagentTool = {
  name: 'call_generator',
  description: 'Create the initial multi-day travel itinerary from the TripBrief and real-world prefetch data. Only for first-time plan creation — to fix an existing plan use call_refiner instead. Requires call_prefetch to have run first in this turn. Streams the itinerary to the client as it generates. After this, call call_evaluator to score the result.',
  parametersSchema: {
    type: 'object',
    properties: {
      brief: { type: 'object', description: 'TripBrief from call_extractor.' },
      prefetchContext: {
        type: 'array',
        items: { type: 'string' },
        description: 'Context strings from call_prefetch. Pass [] if prefetch was skipped.',
      },
      language: { type: 'string', description: 'Output language: "zh" or "en".' },
    },
    required: ['brief', 'prefetchContext', 'language'],
    additionalProperties: false,
  },
  isConcurrencySafe: () => false,
  async call(input, session: SessionState, emit: EmitFn): Promise<SubagentResult> {
    const { brief, prefetchContext, language } = input as {
      brief: TripBrief
      prefetchContext: string[]
      language: string
    }
    await emit({ type: 'agent_step', agent: 'generator', status: 'thinking' })

    let plan = null
    const gen = runInitial(brief, prefetchContext, language)
    while (true) {
      const r = await gen.next()
      // Forward streaming events (token, plan, plan_partial, agent_step) to client
      if (r.value !== undefined && r.value !== null && typeof r.value === 'object' && 'type' in r.value) {
        await emit(r.value as ChatStreamEvent)
      }
      if (r.done) { plan = r.value; break }
    }

    if (!plan) return { type: 'ok', output: 'Generator produced no plan.' }
    session.currentPlan = plan
    session.iterationCount = (session.iterationCount ?? 0) + 1
    await emit({ type: 'agent_step', agent: 'generator', status: 'done' })
    return { type: 'ok', output: JSON.stringify(plan) }
  },
}
