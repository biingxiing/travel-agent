import type { Tool } from '../../runtime/tool-pool.js'
import { generateClarification } from '../../clarifier.js'
import { BlockerTypeEnum } from '@travel-agent/shared'

export const askClarificationTool: Tool = {
  name: 'ask_clarification',
  description: 'Ask the user for a missing destination, travel dates, or traveler count. Use only when one of these three is genuinely unknown. Halts the orchestrator loop and surfaces the question to the user.',
  parametersSchema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        enum: ['missing_origin', 'missing_destination', 'missing_days', 'missing_dates', 'missing_budget', 'unclear_preference', 'other'],
        description: 'Which field is missing.',
      },
    },
    required: ['reason'],
    additionalProperties: false,
  },
  isConcurrencySafe: () => false,
  call: async (input, session, emit) => {
    const reason = BlockerTypeEnum.parse((input as { reason?: string }).reason ?? 'other')
    const { question, defaultSuggestion } = await generateClarification(
      session.messages ?? [], session.brief ?? undefined, reason, session.language ?? 'zh',
    )
    await emit({
      type: 'clarify_needed',
      question,
      reason,
      ...(defaultSuggestion ? { defaultSuggestion } : {}),
    })
    ;(session as { pendingClarification: { reason: typeof reason; question: string; defaultSuggestion: string | null } | null }).pendingClarification = {
      reason, question, defaultSuggestion,
    }
    return { type: 'halt', reason: 'clarification_requested' }
  },
}
