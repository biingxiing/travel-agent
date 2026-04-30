// apps/api/src/agents/tools/extract-brief.tool.ts
import type { SubagentTool, SubagentResult, EmitFn } from '../types.js'
import type { SessionState, TripBrief } from '@travel-agent/shared'
import { extractBrief, type ExtractIntent } from '../../extractor.js'

type CachedExtraction = {
  signature: string
  result: { brief: TripBrief; intent: ExtractIntent; changedFields: string[] }
}
const extractionCache = new WeakMap<SessionState, CachedExtraction>()

export const extractBriefTool: SubagentTool = {
  name: 'call_extractor',
  description: 'Parses user messages into a structured TripBrief (destination, days, origin, dates, budget, travelers, preferences) and infers intent. Returns {brief, intent, changedFields}. Call this tool ONLY WHEN one of: (a) hasBrief is false in session state, or (b) the latest user message introduces new trip facts (destination/dates/travelers/budget/etc.) or explicitly modifies existing brief fields. SKIP this tool when hasBrief is true and the latest user message is a confirmation, a continuation ("keep going", "再优化一下"), or a request that does not change brief fields — in that case, route directly based on session state: hasCurrentPlan=true → call_refiner; hasCurrentPlan=false → call_prefetch then call_generator. After calling extractor, use intent AND session state to decide next step: "new" → call_prefetch then call_generator; "clarify-answer" → call_evaluator; "refine"/"continue" with hasCurrentPlan=true → call_refiner; "refine"/"continue" with hasCurrentPlan=false → treat as "new". IMPORTANT: pass only raw user message strings — never pass "Session state:..." messages.',
  parametersSchema: {
    type: 'object',
    properties: {
      messages: {
        type: 'array',
        items: { type: 'string' },
        description: 'The raw user message strings to parse.',
      },
    },
    required: ['messages'],
    additionalProperties: false,
  },
  isConcurrencySafe: () => true,
  async call(input, session: SessionState, _emit: EmitFn): Promise<SubagentResult> {
    const { messages } = input as { messages: string[] }
    // Filter out session state snapshots that the orchestrator may accidentally include.
    // These start with "Session state:" and are not real user utterances.
    const userMessages = messages.filter(m => !m.startsWith('Session state:'))

    // Short-circuit: if a brief already exists for this session and the input
    // messages are identical to the last extraction, return the cached result
    // instead of paying for another LLM round-trip. The orchestrator's tool
    // description still tells it to skip the call, but this is a defense for
    // when it doesn't.
    const signature = JSON.stringify(userMessages)
    const cached = extractionCache.get(session)
    if (cached && cached.signature === signature && session.brief) {
      return { type: 'ok', output: JSON.stringify(cached.result) }
    }

    const msgs = userMessages.map(content => ({
      role: 'user' as const,
      content,
      timestamp: Date.now(),
    }))
    const result = await extractBrief(msgs, session.brief ?? null)
    session.brief = result.brief
    extractionCache.set(session, { signature, result })
    return { type: 'ok', output: JSON.stringify(result) }
  },
}
