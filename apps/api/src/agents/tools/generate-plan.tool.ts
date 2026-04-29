// apps/api/src/agents/tools/generate-plan.tool.ts
import type { SubagentTool, SubagentResult, EmitFn } from './types.js'
import type { SessionState, ChatStreamEvent } from '@travel-agent/shared'
import { runInitial } from '../generator.js'

export const generatePlanTool: SubagentTool = {
  name: 'call_generator',
  description: 'Create the initial multi-day travel itinerary from the TripBrief and real-world prefetch data. Only for first-time plan creation — to fix an existing plan use call_refiner instead. Requires call_extractor and call_prefetch to have run first. Reads brief and prefetch data from session automatically — invoke with no arguments. Streams the itinerary to the client as it generates. After this, call call_evaluator to score the result. If this tool returns a "Tool error: LLM stream idle" message, retry call_generator immediately — do NOT call call_prefetch again. The prefetch data is already in session.',
  parametersSchema: {
    type: 'object',
    properties: {
      language: { type: 'string', description: 'Optional output language override ("zh" or "en"). Omit to use session.language.' },
    },
    required: [],
    additionalProperties: false,
  },
  isConcurrencySafe: () => false,
  async call(input, session: SessionState, emit: EmitFn): Promise<SubagentResult> {
    const inp = input as { language?: string }
    const brief = session.brief ?? null
    if (!brief) {
      return {
        type: 'ok',
        output: 'No TripBrief in session — call call_extractor first to populate it.',
      }
    }
    // prefetchContext is session-internal — always read from session, never from tool args.
    const prefetchContext = session.prefetchContext ?? []
    const language = typeof inp.language === 'string' && inp.language.length > 0
      ? inp.language
      : (session.language ?? 'zh')
    await emit({ type: 'agent_step', agent: 'generator', status: 'thinking' })

    let plan = null
    const gen = runInitial(brief, prefetchContext, language)
    while (true) {
      const r = await gen.next()
      // Forward streaming events (token, plan, plan_partial, agent_step, error) to client.
      // Skip internal 'done' events — they belong to the generator's own lifecycle, not the
      // outer planning stream (the orchestrator yields its own done when it converges).
      if (r.value !== undefined && r.value !== null && typeof r.value === 'object' && 'type' in r.value) {
        const ev = r.value as ChatStreamEvent
        if (ev.type !== 'done') await emit(ev)
      }
      if (r.done) { plan = r.value; break }
    }

    if (!plan) return { type: 'ok', output: 'Generator produced no plan. Retry call_generator — do NOT call call_clarifier in response to this error.' }
    session.currentPlan = plan
    session.iterationCount = (session.iterationCount ?? 0) + 1
    await emit({ type: 'agent_step', agent: 'generator', status: 'done' })
    return { type: 'ok', output: JSON.stringify(plan) }
  },
}
