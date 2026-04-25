import { z } from 'zod'
import { FAST_MODEL } from '../llm/client.js'
import { loggedCompletion } from '../llm/logger.js'
import { TripBriefSchema, type TripBrief } from '@travel-agent/shared'
import type { Message } from '@travel-agent/shared'
import type OpenAI from 'openai'

const IntentEnum = z.enum(['new', 'refine', 'clarify-answer', 'continue'])
export type ExtractIntent = z.infer<typeof IntentEnum>

const ExtractorOutputSchema = z.object({
  brief: TripBriefSchema.partial().default({}),
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
  for (const re of DESTINATION_REGEXES) {
    const m = text.match(re)
    if (m) { out.destination = m[1]; break }
  }
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

const SYSTEM_PROMPT = `你是旅行需求抽取器。读取用户对话历史和现有 TripBrief（可能为 null），抽取/合并出最新的 TripBrief，并判定本次消息的意图。

输出 JSON（仅输出一个对象，不要 markdown）：
{
  "brief": {
    "destination": "...", "days": 数字, "originCity": "...",
    "travelers": 数字, "preferences": ["..."], "pace": "relaxed|balanced|packed",
    "budget": { "amount": 数字, "currency": "CNY" },
    "travelDates": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
    "notes": "..."
  },
  "intent": "new" | "refine" | "clarify-answer" | "continue",
  "changedFields": ["destination", ...]
}

意图判定规则：
- 用户说"去 X 玩 N 天"等首次描述行程 → "new"
- 用户回答之前问过的问题（如"从上海出发"）→ "clarify-answer"
- 用户在已有行程上说"换酒店"、"加一天" → "refine"
- 用户说"继续优化"、"再来一轮" → "continue"

合并规则：保留 existingBrief 里 user 没改的字段；user 改的字段以新值覆盖。`

export async function extractBrief(
  messages: Message[],
  existingBrief: TripBrief | null,
): Promise<{ brief: TripBrief; intent: ExtractIntent; changedFields: string[] }> {
  const userInput = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n---\n')

  const llmMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `existingBrief:\n${JSON.stringify(existingBrief)}\n\nuserMessages:\n${userInput}`,
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
  const fallback = regexFallback(userInput)
  const briefCandidate = {
    ...(existingBrief ?? {}),
    ...fallback,           // regex first (might be wrong if LLM was right)
    ...parsed.brief,       // LLM overrides regex if it gave a value
    travelers: parsed.brief.travelers ?? fallback.travelers ?? existingBrief?.travelers ?? 1,
    preferences: parsed.brief.preferences ?? existingBrief?.preferences ?? [],
    destination: parsed.brief.destination ?? fallback.destination ?? existingBrief?.destination ?? '',
    days: parsed.brief.days ?? fallback.days ?? existingBrief?.days ?? 0,
  }
  const brief = TripBriefSchema.parse(briefCandidate)

  console.log(`[Extractor] brief=${JSON.stringify(brief)} intent=${parsed.intent} changed=${JSON.stringify(parsed.changedFields)}`)
  return { brief, intent: parsed.intent, changedFields: parsed.changedFields }
}
