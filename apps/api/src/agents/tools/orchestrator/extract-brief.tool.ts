import type { Tool } from '../../runtime/tool-pool.js'
import { extractBrief } from '../../extractor.js'

export const extractBriefTool: Tool = {
  name: 'extract_brief',
  description: 'Distill a TripBrief from the conversation history. Call once for a new request or after the user answers a clarification question. Updates session.brief in place.',
  parametersSchema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
  isConcurrencySafe: () => false,
  call: async (_input, session, emit) => {
    await emit({ type: 'agent_step', agent: 'extractor', status: 'start' })
    try {
      const { brief, intent, changedFields } = await extractBrief(
        session.messages ?? [],
        session.brief ?? null,
      )
      session.brief = brief
      await emit({ type: 'agent_step', agent: 'extractor', status: 'done', output: { intent, changedFields } })
      return {
        type: 'ok',
        output: `TripBrief extracted: ${JSON.stringify(brief)}; intent=${intent}; changedFields=${JSON.stringify(changedFields)}.`,
      }
    } catch (err) {
      await emit({ type: 'agent_step', agent: 'extractor', status: 'error' })
      throw err
    }
  },
}
