import { FAST_MODEL } from '../llm/client.js'
import { loggedCompletion } from '../llm/logger.js'
import { parseLLMJson } from '../llm/json-retry.js'
import { CriticReportSchema, type CriticReport, type Plan, type TripBrief } from '@travel-agent/shared'
import type OpenAI from 'openai'

const SYSTEM_PROMPT_BASE = `You are a travel itinerary reviewer. Read a Plan and TripBrief, identify issues by dimension.

[BLOCKER] (critical missing info — must ask user before proceeding):
- missing_origin: cross-city travel but no departure city
- missing_dates: dates required for flight/hotel booking but absent
- missing_budget: user gave no budget and itinerary quality is ambiguous
- unclear_preference: preferences (food/culture/outdoor) too vague to select attractions
- other: other critical clarification needed

[ITEM ISSUE] (problem with a specific item on a specific day):
- transport: missing flight/train number → suggestedAction: call_flyai_flight or call_flyai_train
- lodging: missing specific hotel/room type → suggestedAction: call_flyai_hotel
- attraction: vague description (missing opening hours / admission / duration) → suggestedAction: rewrite_description
- duplicate or unreasonable item → suggestedAction: replace_item
- out-of-sequence items → suggestedAction: reorder
severity: high (score < 50) | medium (50–79) | low (≥ 80)

[GLOBAL ISSUE]: repeated attractions, unbalanced pace, thematic inconsistency, etc.

Output JSON (one object, no markdown):
{
  "qualityScore": 0-100,
  "blockers": [{ "type": "...", "message": "<question string in OUTPUT_LANGUAGE>" }],
  "itemIssues": [{
    "dayNum": number, "itemIndex": number, "severity": "high|medium|low",
    "category": "transport|lodging|attraction|meal|coherence",
    "problem": "...", "suggestedAction": "...",
    "hints": { /* optional: params for flyai calls */ }
  }],
  "globalIssues": ["..."]
}`

const FALLBACK: CriticReport = {
  qualityScore: 0, blockers: [], itemIssues: [], globalIssues: [],
}

export async function criticReview(plan: Plan, brief: TripBrief, language = 'zh'): Promise<CriticReport> {
  const systemPrompt = SYSTEM_PROMPT_BASE.replace(
    'OUTPUT_LANGUAGE',
    language === 'zh' ? 'Chinese (Simplified)' : language,
  )

  const llmMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `TripBrief:\n${JSON.stringify(brief)}\n\nPlan:\n${JSON.stringify(plan)}`,
    },
  ]

  let firstContent: string
  try {
    const resp = await loggedCompletion('critic', {
      model: FAST_MODEL,
      messages: llmMessages,
      temperature: 0.2,
    })
    firstContent = resp.choices[0]?.message?.content ?? ''
  } catch (err) {
    console.warn('[Critic] LLM call failed:', err instanceof Error ? err.message : err)
    return FALLBACK
  }

  const retry = async (): Promise<string> => {
    const resp = await loggedCompletion('critic', {
      model: FAST_MODEL,
      messages: [
        ...llmMessages,
        { role: 'assistant', content: firstContent },
        { role: 'user', content: 'Your last reply was not valid JSON. Output ONLY one JSON object matching the schema, no prose, no code fences.' },
      ],
      temperature: 0.2,
    })
    return resp.choices[0]?.message?.content ?? ''
  }

  const parsed = await parseLLMJson(firstContent, CriticReportSchema, retry)
  if (parsed) return parsed
  console.warn(`[Critic] Parse failed after retry (raw="${firstContent.slice(0, 200).replace(/\n/g, '\\n')}")`)
  return FALLBACK
}
