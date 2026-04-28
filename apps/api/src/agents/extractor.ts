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
const TRAVELERS_REGEXES = [
  /(\d+)\s*(?:个人|人|位)/,
  /出行人数\s*[:：]?\s*(\d+)/,
]
const PREFERENCE_KEYWORDS = ['亲子', '美食', '必打卡', '特色', '历史', '自然', '购物', '夜生活']
// Match a leading Chinese-comma-separated city list at the very start of the message
// e.g. "顺德，珠海， 出行人数3..." → first segment splits into ["顺德", "珠海"]
const BARE_LIST_REGEX = /^([一-龥，,、\s]+)/
const CHINESE_DATE_REGEX = /(\d{4})?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[号日]/g

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function regexFallback(text: string, todayISO: string): Partial<TripBrief> {
  const out: Partial<TripBrief> = {}
  const currentYear = todayISO.slice(0, 4)

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

  // If existing patterns produced nothing, try the bare comma-separated list at the start
  if (foundDests.length === 0) {
    const m = text.match(BARE_LIST_REGEX)
    if (m && m[1]) {
      const tokens = m[1]
        .split(/[，,、\s]+/)
        .map((t) => t.trim())
        .filter((t) => /^[一-龥]{2,8}$/.test(t))
      for (const t of tokens) {
        if (!foundDests.includes(t)) foundDests.push(t)
      }
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

  // Date pass — collect all "M月D号/日" occurrences. First two become start/end.
  const dateMatches: { year: string; month: number; day: number; index: number }[] = []
  for (const m of text.matchAll(CHINESE_DATE_REGEX)) {
    let year = m[1]
    if (!year) {
      // Look for a 4-digit year within ~6 chars before the match
      const lookback = text.slice(Math.max(0, (m.index ?? 0) - 6), m.index ?? 0)
      const y = lookback.match(/(\d{4})/)
      year = y ? y[1] : currentYear
    }
    dateMatches.push({
      year,
      month: parseInt(m[2], 10),
      day: parseInt(m[3], 10),
      index: m.index ?? 0,
    })
  }
  if (dateMatches.length >= 2) {
    const [a, b] = dateMatches
    out.travelDates = {
      start: `${a.year}-${pad2(a.month)}-${pad2(a.day)}`,
      end: `${b.year}-${pad2(b.month)}-${pad2(b.day)}`,
    }
  }

  // Preferences pass — push every keyword that appears
  const prefs: string[] = []
  for (const kw of PREFERENCE_KEYWORDS) {
    if (text.includes(kw) && !prefs.includes(kw)) prefs.push(kw)
  }
  if (prefs.length > 0) out.preferences = prefs

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
    "travelDates": { "start": "2026-MM-DD", "end": "2026-MM-DD" },
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

Field rules:
- When a field is unknown, OMIT the key entirely. Never emit \`null\` — emit either a value or omit the field.
- Dates: use 4-digit years in ISO format (e.g. "2026-05-02"). If the user did not state a year, use the current year provided in the user message ("Today is …").

Merge rules: preserve unchanged fields from existingBrief; overwrite only the fields the user explicitly changed. Use allMessages for brief field merging.`

function todayISODate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function sanitizeYearPlaceholders<T extends { travelDates?: { start?: string; end?: string } | null }>(
  brief: T,
  currentYear: string,
): T {
  if (brief.travelDates && typeof brief.travelDates === 'object') {
    const td = brief.travelDates as { start?: string; end?: string }
    if (typeof td.start === 'string' && /^Y{2,4}-/.test(td.start)) {
      td.start = td.start.replace(/^Y{2,4}/, currentYear)
    }
    if (typeof td.end === 'string' && /^Y{2,4}-/.test(td.end)) {
      td.end = td.end.replace(/^Y{2,4}/, currentYear)
    }
  }
  return brief
}

function inferDaysFromTravelDates(start: string, end: string): number | undefined {
  const s = Date.parse(start)
  const e = Date.parse(end)
  if (Number.isNaN(s) || Number.isNaN(e)) return undefined
  const diffMs = e - s
  const oneDay = 24 * 60 * 60 * 1000
  const days = Math.round(diffMs / oneDay) + 1 // inclusive
  return Math.max(1, days)
}

export async function extractBrief(
  messages: Message[],
  existingBrief: TripBrief | null,
): Promise<{ brief: TripBrief; intent: ExtractIntent; changedFields: string[] }> {
  const allUserText = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n---\n')
  const latestUserText = messages.filter((m) => m.role === 'user').at(-1)?.content ?? allUserText

  const todayISO = todayISODate()
  const currentYear = todayISO.slice(0, 4)

  const llmMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Today is ${todayISO}.\n\nexistingBrief:\n${JSON.stringify(existingBrief)}\n\nallMessages:\n${allUserText}\n\nlatestMessage:\n${latestUserText}`,
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
      const rawParsed = JSON.parse(content) as { brief?: unknown; intent?: unknown; changedFields?: unknown }
      // Sanitize literal "YYYY-..." placeholders before zod parsing
      if (rawParsed && typeof rawParsed === 'object' && rawParsed.brief && typeof rawParsed.brief === 'object') {
        sanitizeYearPlaceholders(rawParsed.brief as { travelDates?: { start?: string; end?: string } }, currentYear)
      }
      try {
        parsed = ExtractorOutputSchema.parse(rawParsed)
      } catch (zerr) {
        const issues = zerr instanceof z.ZodError ? JSON.stringify(zerr.issues) : (zerr instanceof Error ? zerr.message : String(zerr))
        console.warn(`[Extractor] zod parse failed, using regex fallback. issues=${issues} raw="${content.slice(0, 200)}"`)
      }
    } catch (err) {
      console.warn(`[Extractor] LLM output parse failed, using regex fallback. raw="${content.slice(0, 200)}" err=${err instanceof Error ? err.message : err}`)
    }
  } catch (err) {
    console.warn(`[Extractor] LLM call failed, using regex fallback: ${err instanceof Error ? err.message : err}`)
  }

  // Always regex-augment from the latest user message — LLM may miss obvious fields
  const fallback = regexFallback(allUserText, todayISO)
  const briefCandidate: Record<string, unknown> = {
    ...(existingBrief ?? {}),
    ...fallback,           // regex first (might be wrong if LLM was right)
    ...parsed.brief,       // LLM overrides regex if it gave a value
    travelers: parsed.brief.travelers ?? fallback.travelers ?? existingBrief?.travelers ?? 1,
    preferences: parsed.brief.preferences ?? fallback.preferences ?? existingBrief?.preferences ?? [],
    destinations: parsed.brief.destinations ?? fallback.destinations ?? existingBrief?.destinations ?? [],
    days: parsed.brief.days ?? fallback.days ?? existingBrief?.days ?? 0,
  }

  // travelDates: prefer LLM, fall back to regex, fall back to existing
  const travelDates = parsed.brief.travelDates ?? fallback.travelDates ?? existingBrief?.travelDates
  if (travelDates) {
    briefCandidate.travelDates = travelDates
  }

  // Days inference — if dates are known but days is 0/missing, derive inclusive day count
  if ((!briefCandidate.days || briefCandidate.days === 0) && travelDates) {
    const inferred = inferDaysFromTravelDates(travelDates.start, travelDates.end)
    if (inferred !== undefined) briefCandidate.days = inferred
  }

  const brief = TripBriefSchema.parse(briefCandidate)

  console.log(`[Extractor] brief=${JSON.stringify(brief)} intent=${parsed.intent} changed=${JSON.stringify(parsed.changedFields)}`)
  return { brief, intent: parsed.intent, changedFields: parsed.changedFields }
}
