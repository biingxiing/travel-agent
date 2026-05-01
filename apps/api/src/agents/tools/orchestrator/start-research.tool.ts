import { z } from 'zod'
import type { Tool } from '../../runtime/tool-pool.js'
import { sendMessage } from '../../runtime/send-message.js'
import type { Trace } from '../../runtime/trace.js'

const InSchema = z.object({
  researchGoals: z.array(z.string()).min(1)
    .describe('Concrete research topics, e.g. ["transport", "weather", "hotels", "attractions"]'),
})

interface ResearcherOutput {
  ok: boolean
  summary?: string
  sources?: string[]
  error?: string
}

export const startResearchTool: Tool = {
  name: 'start_research',
  description: 'Spawn a Researcher subagent to gather real-world data. May be invoked multiple times in the same turn to research different goals in parallel.',
  parametersSchema: {
    type: 'object',
    properties: {
      researchGoals: {
        type: 'array',
        items: { type: 'string' },
        description: 'Concrete research topics, e.g. ["transport", "weather", "hotels", "attractions"]',
        minItems: 1,
      },
    },
    required: ['researchGoals'],
    additionalProperties: false,
  },
  isConcurrencySafe: () => true,
  call: async (input, session, emit) => {
    const { researchGoals } = InSchema.parse(input)
    if (!session.brief) {
      return { type: 'ok', output: 'Cannot start research without a TripBrief. Call extract_brief first.' }
    }

    // The runtime injects __runtime__ on the session right before dispatching tool calls.
    const runtime = (session as { __runtime__?: { trace: Trace; runId: string; childCounter: { next(): number } } }).__runtime__
    if (!runtime) throw new Error('start_research called without runtime context')

    await emit({ type: 'agent_step', agent: 'researcher', status: 'start', input: { researchGoals } })
    const out = await sendMessage<unknown, ResearcherOutput>('researcher', {
      brief: session.brief,
      researchGoals,
    }, {
      session,
      parentRunId: runtime.runId,
      parentPersona: 'orchestrator',
      trace: runtime.trace,
      childIndex: runtime.childCounter.next(),
    })

    if (out.ok) {
      const summary = out.summary ?? ''
      const sources = out.sources ?? []
      session.prefetchContext = [...(session.prefetchContext ?? []), summary]
      await emit({ type: 'agent_step', agent: 'researcher', status: 'done', output: { sources } })
      return { type: 'ok', output: `Research summary appended to session. sources=${sources.join(', ')}` }
    } else {
      await emit({ type: 'agent_step', agent: 'researcher', status: 'error', output: { error: out.error } })
      return { type: 'ok', output: `Research failed: ${out.error}` }
    }
  },
}
