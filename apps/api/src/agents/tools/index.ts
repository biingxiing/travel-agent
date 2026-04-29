// apps/api/src/agents/tools/index.ts
import type OpenAI from 'openai'
import type { SubagentTool } from './types.js'
import type { SessionState } from '@travel-agent/shared'
import { extractBriefTool } from './extract-brief.tool.js'
import { prefetchContextTool } from './prefetch-context.tool.js'
import { generatePlanTool } from './generate-plan.tool.js'
import { evaluatePlanTool } from './evaluate-plan.tool.js'
import { refinePlanTool } from './refine-plan.tool.js'
import { askClarificationTool } from './ask-clarification.tool.js'

export { type SubagentTool } from './types.js'
export { type EmitFn } from './types.js'
export { type LoopState } from './types.js'

export const ALL_TOOLS: SubagentTool[] = [
  extractBriefTool,
  prefetchContextTool,
  generatePlanTool,
  evaluatePlanTool,
  refinePlanTool,
  askClarificationTool,
]

export function toOpenAITools(tools: SubagentTool[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parametersSchema,
    },
  }))
}

export const ORCHESTRATOR_SYSTEM_PROMPT = `You are an expert travel-planning orchestrator building personalized itineraries.

A great travel plan goes beyond logistics. It reflects who the traveler is: how many people are going, whether they prefer trains or flights, whether they want a packed itinerary or a leisurely pace, their interests (history, food, nature, nightlife, shopping), budget sensitivity, and any special needs. The more you understand about the traveler, the better the plan.

Use judgment about when to gather more information versus when to proceed. If the traveler's messages give you enough to work with, start planning. If key details are missing or knowing them would meaningfully change the itinerary, use the clarification tool — ask all important open questions together in one call rather than one at a time, and only ask when it genuinely matters.

The cost is asymmetric: asking the traveler a question is cheap and surfaces details that meaningfully sharpen the plan, while skipping a detail that turns out to matter can produce an itinerary that misses the mark — wrong pace, wrong budget tier, wrong interests, or logistics that don't fit the group. When in doubt, lean toward asking rather than guessing.

Ground every itinerary in real-world data. Use the available tools to look up actual transportation options, weather patterns, attraction hours and ticketing, and accommodation conditions for the destination and travel dates. If live data is unavailable after querying, you may reason from recent historical data (prior years), but you must explicitly state that the information is inferred, explain why live data could not be retrieved, and cite the historical source. Never invent facts about schedules, prices, operating status, or travel times. Never plan an itinerary that violates physical reality — for example, routing that requires covering impossible distances within the available time.

After the itinerary is complete, review it against the traveler's stated requirements and flag any gaps or mismatches before delivering the final plan.
`

export function buildStateContextMessage(
  session: SessionState,
): OpenAI.Chat.ChatCompletionMessageParam {
  return {
    role: 'user',
    content: `Session state:\n${JSON.stringify({
      hasBrief: !!session.brief,
      brief: session.brief,
      hasCurrentPlan: !!session.currentPlan,
      currentScore: session.currentScore,
      language: session.language ?? 'zh',
      iterationCount: session.iterationCount,
      status: session.status,
      prefetchContextSize: session.prefetchContext?.length ?? 0,
    })}`,
  }
}

export function buildOrchestratorMessages(
  session: SessionState,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const conversationHistory = session.messages
    .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0)
    .slice(-20)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  return [
    { role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT },
    ...conversationHistory,
    buildStateContextMessage(session),
  ]
}
