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

export const ORCHESTRATOR_SYSTEM_PROMPT = `You are a travel planning orchestrator. Your goal is to create a high-quality travel itinerary using specialized subagent tools.

Workflow:
1. Call call_extractor with the user's raw messages to get a TripBrief.
2. If critical info is missing (destination or days), call call_clarifier to ask — this halts the loop.
3. Call call_prefetch with the TripBrief to get real-world flight/hotel/POI data.
4. Call call_generator with the brief, prefetch context, and language to create the initial itinerary.
5. Call call_evaluator to score the plan. Check the returned EvaluationReport:
   - If converged is true: stop calling tools and output a brief confirmation in the user's language.
   - If blockers exist: call call_clarifier.
   - If score < 90: call call_refiner with the plan, brief, report, and prefetch context.
6. After call_refiner: call call_evaluator again.
7. If still not converged after one refine: stop calling tools (the client will surface the plan).

When you stop calling tools, write a short confirmation message in the user's preferred language.
Never skip call_extractor on the first turn.
`

export function buildOrchestratorMessages(
  session: SessionState,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const userMessagesText = session.messages
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .join('\n---\n')

  const stateContext = JSON.stringify({
    hasBrief: !!session.brief,
    brief: session.brief,
    hasCurrentPlan: !!session.currentPlan,
    currentScore: session.currentScore,
    language: session.language ?? 'zh',
    iterationCount: session.iterationCount,
    status: session.status,
    prefetchContextSize: session.prefetchContext?.length ?? 0,
  })

  return [
    { role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Session state:\n${stateContext}\n\nUser messages:\n${userMessagesText}`,
    },
  ]
}
