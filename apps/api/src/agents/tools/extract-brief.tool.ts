// apps/api/src/agents/tools/extract-brief.tool.ts
import type { SubagentTool, SubagentResult, EmitFn } from './types.js'
import type { SessionState } from '@travel-agent/shared'
import { extractBrief } from '../extractor.js'

export const extractBriefTool: SubagentTool = {
  name: 'call_extractor',
  description: 'Parse user messages into a structured TripBrief. Call this first to understand the trip request. Returns JSON with {brief, intent, changedFields}.',
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
