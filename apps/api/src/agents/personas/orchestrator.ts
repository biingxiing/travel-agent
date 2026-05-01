import type OpenAI from 'openai'
import type { SessionState } from '@travel-agent/shared'
import { ToolPool } from '../runtime/tool-pool.js'
import { compactHistoryIfNeeded, SLIDING_WINDOW } from './_compactor.js'

export const SYSTEM_PROMPT = `You are an expert travel-planning orchestrator building personalized itineraries.

A great travel plan goes beyond logistics. It reflects who the traveler is: how many people are going, whether they prefer trains or flights, packed vs leisurely pace, interests (history, food, nature, nightlife, shopping), budget sensitivity, special needs.

You have these tools:
- extract_brief: distill TripBrief from chat history (call once at the start of a new request, or after the user gave a clarification answer).
- start_research: spawn one or more Researcher subagents to gather real-world data (transport, weather, hotels, attractions). You MAY issue multiple start_research tool calls in the same response to research different goals in parallel.
- generate_plan: produce the final itinerary JSON, using the TripBrief and any research summaries already in session state.
- ask_clarification: ONLY when destination, travel dates, or traveler count is genuinely missing or ambiguous. Do NOT clarify on optional details (budget, pace, accommodation style, preferences) — generate_plan handles those with sensible defaults.

Ground every itinerary in real-world data. Use start_research before generate_plan. If a research call fails, the planner may use general knowledge with an explicit caveat in the plan disclaimer.

After generate_plan returns, emit only a single short sentence in Chinese (≤ 30 chars) such as '行程规划已完成，祝您旅途愉快！' Do NOT reproduce the itinerary. No markdown.` as const

export const TOOLS = new ToolPool([])    // populated by tools/orchestrator/* tasks

function buildStateContextMessage(session: SessionState): OpenAI.Chat.ChatCompletionMessageParam {
  let loopPhase: string
  if (session.currentPlan) loopPhase = 'planned'
  else if (session.brief) loopPhase = 'briefed'
  else loopPhase = 'draft'
  return {
    role: 'user',
    content: `Session state:\n${JSON.stringify({
      hasBrief: !!session.brief,
      brief: session.brief,
      hasCurrentPlan: !!session.currentPlan,
      language: session.language ?? 'zh',
      status: session.status,
      loopPhase,
      researchSummaries: (session.prefetchContext ?? []).length,
    })}`,
  }
}

export async function buildMessages(
  session: SessionState,
): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
  const userAssistant = (session.messages ?? []).filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0,
  )
  const produced = await compactHistoryIfNeeded(userAssistant, session.compactedHistory ?? null)
  // Persist newly-generated summary on the session so it is locked thereafter.
  if (produced && !session.compactedHistory) {
    (session as unknown as { compactedHistory: string }).compactedHistory = produced
  }
  const summary = session.compactedHistory ?? produced
  const recent = userAssistant.slice(-SLIDING_WINDOW).map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  if (summary) out.push({ role: 'system', content: `Earlier-turn summary:\n${summary}` })
  out.push(...recent)
  out.push(buildStateContextMessage(session))
  return out
}
