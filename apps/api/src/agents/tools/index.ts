// apps/api/src/agents/tools/index.ts
import type OpenAI from 'openai'
import type { SubagentTool } from './types.js'
import type { SessionState } from '@travel-agent/shared'
import { extractBriefTool } from './agent/extract-brief.tool.js'
import { prefetchContextTool } from './mcp/prefetch-context.tool.js'
import { generatePlanTool } from './agent/generate-plan.tool.js'
import { evaluatePlanTool } from './evaluate-plan.tool.js'
import { refinePlanTool } from './refine-plan.tool.js'
import { askClarificationTool } from './agent/ask-clarification.tool.js'

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

**Clarification rule (strict):** Only call \`call_clarifier\` when at least one of these three is genuinely missing or ambiguous: destination, travel dates, or traveler count. If all three are known — even approximately — proceed immediately to \`call_prefetch\` then \`call_generator\`. Do NOT call \`call_clarifier\` because budget, pace, accommodation style, or personal preferences are unspecified; the generator handles those with sensible defaults. Halting for optional details wastes the traveler's time and is always the wrong choice when a workable plan can be produced.

Ground every itinerary in real-world data. Use the available tools to look up actual transportation options, weather patterns, attraction hours and ticketing, and accommodation conditions for the destination and travel dates. If live data is unavailable after querying, you may reason from recent historical data (prior years), but you must explicitly state that the information is inferred, explain why live data could not be retrieved, and cite the historical source. Never invent facts about schedules, prices, operating status, or travel times. Never plan an itinerary that violates physical reality — for example, routing that requires covering impossible distances within the available time.

After the itinerary is complete, review it against the traveler's stated requirements and flag any gaps or mismatches before delivering the final plan.

**Error recovery rule:** If call_generator returns a transient error (e.g. "Tool error: LLM stream idle"), retry call_generator immediately. Do NOT call call_prefetch — when prefetchContextSize > 0 the prefetch data is already in session and re-running call_prefetch wastes time without adding new data.

**Post-evaluator rule (MANDATORY):** After call_evaluator returns:
- If converged=true: stop tool calls and emit ONLY a single short sentence in Chinese (30 characters or fewer). Do NOT reproduce the itinerary. Do NOT use markdown headers, bullet points, or bold text. Example: '行程规划已完成，祝您旅途愉快！'
- If converged=false: your ONLY valid next action is call_refiner. You MUST NOT emit plain text, MUST NOT call call_clarifier, and MUST NOT summarise the evaluation results in prose. Producing free-text narrative instead of calling call_refiner when converged=false is a critical error that bypasses the refinement loop entirely.
`

export function buildStateContextMessage(
  session: SessionState,
): OpenAI.Chat.ChatCompletionMessageParam {
  // Derive a more accurate phase from what is actually populated in the session
  // rather than relying on session.status, which stays 'draft' throughout the
  // entire ReAct loop and is only updated at the very end.
  let loopPhase: string
  if (session.currentScore) {
    loopPhase = 'scored'
  } else if (session.currentPlan) {
    loopPhase = 'planned'
  } else if (session.brief) {
    loopPhase = 'briefed'
  } else {
    loopPhase = 'draft'
  }

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
      loopPhase,
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
