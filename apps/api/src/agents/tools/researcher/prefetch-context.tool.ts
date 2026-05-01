import type { Tool } from '../../runtime/tool-pool.js'
import { prefetchFlyaiContext } from '../../prefetch.js'

export const prefetchContextTool: Tool = {
  name: 'prefetch_context',
  description:
    'Fetch real-world flight, train, hotel, and POI data for the current TripBrief from the flyai data source. Returns a single string containing all results, sectioned per query.',
  parametersSchema: {
    type: 'object',
    properties: {
      // No parameters — implicitly uses session.brief.
    },
    required: [],
    additionalProperties: false,
  },
  isConcurrencySafe: () => true,
  call: async (_input, session, _emit) => {
    if (!session.brief) {
      return { type: 'ok', output: 'No TripBrief available; cannot prefetch.' }
    }
    const ctx = await prefetchFlyaiContext(session.brief, session.id)
    return {
      type: 'ok',
      output: ctx.length > 0 ? ctx.join('\n\n---\n\n') : 'No data returned by flyai.',
    }
  },
}
