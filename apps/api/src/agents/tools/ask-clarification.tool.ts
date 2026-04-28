// apps/api/src/agents/tools/ask-clarification.tool.ts
import type { SubagentTool, SubagentResult, EmitFn } from './types.js'
import type { SessionState, TripBrief } from '@travel-agent/shared'
import { generateClarification } from '../clarifier.js'

type ClarifyReason = 'missing_destination' | 'missing_days' | 'missing_dates'

export const askClarificationTool: SubagentTool = {
  name: 'call_clarifier',
  description: 'Ask the traveler a single warm clarifying question when destination, days, or dates are missing and cannot be inferred from context. Emits a clarify_needed event and HALTS the planning loop — do not call any other tool after this in the same run. The loop resumes automatically on the user\'s next message.',
  parametersSchema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        enum: ['missing_destination', 'missing_days', 'missing_dates'],
        description: 'What critical information is missing.',
      },
      brief: {
        type: 'object',
        description: 'Current TripBrief (partial is fine).',
      },
      language: { type: 'string', description: 'User language for the question.' },
    },
    required: ['reason', 'brief', 'language'],
    additionalProperties: false,
  },
  isConcurrencySafe: () => false,
  async call(input, session: SessionState, emit: EmitFn): Promise<SubagentResult> {
    const { reason, brief, language } = input as {
      reason: ClarifyReason
      brief: Partial<TripBrief>
      language: string
    }
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
