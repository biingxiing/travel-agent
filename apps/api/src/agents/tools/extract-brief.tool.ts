// apps/api/src/agents/tools/extract-brief.tool.ts
import type { SubagentTool, SubagentResult, EmitFn } from './types.js'
import type { SessionState } from '@travel-agent/shared'
import { extractBrief } from '../extractor.js'

export const extractBriefTool: SubagentTool = {
  name: 'call_extractor',
  description: 'Call first on every turn before doing anything else. Parses all user messages into a structured TripBrief (destination, days, origin, dates, budget, travelers, preferences) and infers intent. Returns {brief, intent, changedFields}. Use intent to decide what to call next: "new" → call call_prefetch to start fresh; "refine" or "continue" → call call_refiner with the existing plan; "clarify-answer" → call call_evaluator to re-check the current plan.',
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
    // Isolated context: construct Message objects from the passed strings only
    const msgs = messages.map(content => ({
      role: 'user' as const,
      content,
      timestamp: Date.now(),
    }))
    const result = await extractBrief(msgs, session.brief ?? null)
    session.brief = result.brief
    return { type: 'ok', output: JSON.stringify(result) }
  },
}
