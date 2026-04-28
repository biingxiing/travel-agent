import { z } from 'zod'
import { FAST_MODEL } from '../llm/client.js'
import { loggedCompletion } from '../llm/logger.js'
import { TripBriefSchema, rawBriefShape, type TripBrief } from '@travel-agent/shared'
import type { Message } from '@travel-agent/shared'
import type OpenAI from 'openai'

const IntentEnum = z.enum(['new', 'refine', 'clarify-answer', 'continue'])
export type ExtractIntent = z.infer<typeof IntentEnum>

const ExtractorOutputSchema = z.object({
  brief: rawBriefShape.partial().default({}),
  intent: IntentEnum.default('new'),
  changedFields: z.array(z.string()).default([]),
})
export type ExtractorOutput = z.infer<typeof ExtractorOutputSchema>

const DAYS_REGEXES = [/(\d+)\s*天/, /(\d+)\s*-?\s*day/i]
// stop at common trailing verbs (玩/游/旅/度/看) or punctuation/digits/space
const DESTINATION_REGEXES = [
  /(?:去|到|前往)\s*([一-龥]{2,8}?)(?=玩|游|旅|度|看|呆|住|，|。|\s|\d|$)/,
  /规划\s*([一-龥]{2,8}?)(?=\s|\d|玩|游|旅|度|，|。|的|$)/,
  /(?:目的地|地点)\s*[:：]?\s*([一-龥]{2,8})/,
]
const ORIGIN_REGEXES = [/(?:从|由)\s*([一-龥]{2,8}?)(?=出发|出|，|。|\s|$)/]
const TRAVELERS_REGEXES = [/(\d+)\s*(?:个人|人|位)/]

function regexFallback(text: string): Partial<TripBrief> {
  const out: Partial<TripBrief> = {}
  for (const re of DAYS_REGEXES) {
    const m = text.match(re)
    if (m) { out.days = parseInt(m[1], 10); break }
  }
  const foundDests: string[] = []
  for (const re of DESTINATION_REGEXES) {
    const globalRe = new RegExp(re.source, (re.flags ?? '').replace('g', '') + 'g')
    for (const m of text.matchAll(globalRe)) {
      if (m[1] && !foundDests.includes(m[1])) foundDests.push(m[1])
    }
  }
  if (foundDests.length > 0) out.destinations = foundDests
  for (const re of ORIGIN_REGEXES) {
    const m = text.match(re)
    if (m) { out.originCity = m[1]; break }
  }
  for (const re of TRAVELERS_REGEXES) {
    const m = text.match(re)
    if (m) { out.travelers = parseInt(m[1], 10); break }
  }
  return out
}

const SYSTEM_PROMPT = `You are a travel intent extractor. Read the conversation history and existing TripBrief (may be null), extract/merge the latest TripBrief, and determine the user's intent.

Output JSON (one object only, no markdown):
{
  "brief": {
    "destinations": ["city1", "city2"],
    "days": number,
    "originCity": "...",
    "travelers": number,
    "preferences": ["..."],
    "pace": "relaxed|balanced|packed",
    "budget": { "amount": number, "currency": "CNY" },
    "travelDates": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
    "notes": "..."
  },
  "intent": "new" | "refine" | "clarify-answer" | "continue",
  "changedFields": ["destinations", ...]
}

Intent classification rules:
- User describes a trip for the first time ("go to X for N days") → "new"
- User answers a previous clarifying question ("departing from Shanghai") → "clarify-answer"
- User modifies an existing plan ("change the hotel", "add one more day") → "refine"
- User asks to continue optimizing ("keep refining", "try again") → "continue"
Determine intent from latestMessage only, not from the full message history.

Merge rules: preserve unchanged fields from existingBrief; overwrite only the fields the user explicitly changed. Use allMessages for brief field merging.`

export async function extractBrief(
  messages: Message[],
  existingBrief: TripBrief | null,
): Promise<{ brief: TripBrief; intent: ExtractIntent; changedFields: string[] }> {
  const allUserText = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n---\n')
  const latestUserText = messages.filter((m) => m.role === 'user').at(-1)?.content ?? allUserText

  const llmMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `existingBrief:\n${JSON.stringify(existingBrief)}\n\nallMessages:\n${allUserText}\n\nlatestMessage:\n${latestUserText}`,
    },
  ]

  let parsed: ExtractorOutput = { brief: {}, intent: 'new', changedFields: [] }
  try {
    const resp = await loggedCompletion('extractor', {
      model: FAST_MODEL,
      messages: llmMessages,
      temperature: 0,
      response_format: { type: 'json_object' },
    })
    const content = resp.choices[0]?.message?.content ?? '{}'
    try {
      parsed = ExtractorOutputSchema.parse(JSON.parse(content))
    } catch (err) {
      console.warn(`[Extractor] LLM output parse failed, using regex fallback. raw="${content.slice(0, 200)}" err=${err instanceof Error ? err.message : err}`)
    }
  } catch (err) {
    console.warn(`[Extractor] LLM call failed, using regex fallback: ${err instanceof Error ? err.message : err}`)
  }

  // Always regex-augment from the latest user message — LLM may miss obvious fields
  const fallback = regexFallback(allUserText)
  const briefCandidate = {
    ...(existingBrief ?? {}),
    ...fallback,           // regex first (might be wrong if LLM was right)
    ...parsed.brief,       // LLM overrides regex if it gave a value
    travelers: parsed.brief.travelers ?? fallback.travelers ?? existingBrief?.travelers ?? 1,
    preferences: parsed.brief.preferences ?? existingBrief?.preferences ?? [],
    destinations: parsed.brief.destinations ?? fallback.destinations ?? existingBrief?.destinations ?? [],
    days: parsed.brief.days ?? fallback.days ?? existingBrief?.days ?? 0,
  }
  const brief = TripBriefSchema.parse(briefCandidate)

  console.log(`[Extractor] brief=${JSON.stringify(brief)} intent=${parsed.intent} changed=${JSON.stringify(parsed.changedFields)}`)
  return { brief, intent: parsed.intent, changedFields: parsed.changedFields }
}
