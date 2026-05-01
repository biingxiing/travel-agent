import type { Tool } from '../../runtime/tool-pool.js'
import { runInitial } from '../../generator.js'

export const generatePlanTool: Tool = {
  name: 'generate_plan',
  description: 'Generate the final travel itinerary using the current TripBrief and any prefetched real-world data in the session. Streams plan tokens to the user. Sets session.currentPlan on success.',
  parametersSchema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
  isConcurrencySafe: () => false,
  call: async (_input, session, emit) => {
    if (!session.brief) {
      return { type: 'ok', output: 'Cannot generate plan: TripBrief not yet extracted. Call extract_brief first.' }
    }
    await emit({ type: 'agent_step', agent: 'generator', status: 'start' })
    let planSet = false
    try {
      for await (const event of runInitial(session.brief, session.prefetchContext ?? [], session.language ?? 'zh')) {
        await emit(event)
        if (event.type === 'plan') {
          (session as { currentPlan: typeof event.plan | null }).currentPlan = event.plan
          planSet = true
        }
      }
      await emit({ type: 'agent_step', agent: 'generator', status: 'done' })
      return {
        type: 'ok',
        output: planSet ? 'Plan generated and stored in session.currentPlan.' : 'Plan generation completed without a final plan; consider asking the user for clarification.',
      }
    } catch (err) {
      await emit({ type: 'agent_step', agent: 'generator', status: 'error' })
      throw err
    }
  },
}
