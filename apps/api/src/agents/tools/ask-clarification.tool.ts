// apps/api/src/agents/tools/ask-clarification.tool.ts
import type { SubagentTool, SubagentResult, EmitFn } from './types.js'
import type { SessionState, TripBrief, BlockerType } from '@travel-agent/shared'
import { generateClarification } from '../clarifier.js'

export const askClarificationTool: SubagentTool = {
  name: 'call_clarifier',
  description: 'Ask the traveler a single warm clarifying question when any critical planning information is missing or unclear. Use this for missing destination, dates, traveler details (e.g. child age/height for family trips), budget, or any unclear preference that would materially change the itinerary. Emits a clarify_needed event and HALTS the planning loop — do not call any other tool after this in the same run. The loop resumes automatically on the user\'s next message. (brief is read from session automatically; only pass it if you want to override)',
  parametersSchema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        enum: ['missing_origin', 'missing_destination', 'missing_days', 'missing_dates', 'missing_budget', 'unclear_preference', 'other'],
        description: 'Category of missing information.',
      },
      brief: {
        type: 'object',
        description: 'Current TripBrief (partial is fine).',
      },
      language: { type: 'string', description: 'User language for the question.' },
    },
    required: ['reason', 'language'],
    additionalProperties: false,
  },
  isConcurrencySafe: () => false,
  async call(input, session: SessionState, emit: EmitFn): Promise<SubagentResult> {
    const { reason, brief: briefArg, language } = input as {
      reason: BlockerType
      brief?: Partial<TripBrief>
      language: string
    }
    const brief = briefArg ?? session.brief ?? undefined
    // Pass session messages for context-aware question generation
    const msgs = session.messages.map(m => ({ ...m }))
    const { question, defaultSuggestion } = await generateClarification(msgs, brief, reason, language)
    session.status = 'awaiting_user'
    session.pendingClarification = question
    await emit({
      type: 'clarify_needed',
      question,
      reason,
      ...(defaultSuggestion !== null ? { defaultSuggestion } : {}),
    })
    return { type: 'halt', reason: 'clarification_requested' }
  },
}
