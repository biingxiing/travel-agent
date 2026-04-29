import { FAST_MODEL } from '../llm/client.js'
import { loggedCompletion } from '../llm/logger.js'
import type { TripBrief, Message, BlockerType } from '@travel-agent/shared'

type ClarifyReason = BlockerType

interface ClarifyResult {
  question: string
  defaultSuggestion: string | null
}

const FALLBACKS: Partial<Record<ClarifyReason, Record<string, ClarifyResult>>> = {
  missing_destination: {
    zh: { question: '你想去哪里旅行？', defaultSuggestion: null },
    en: { question: 'Where would you like to travel?', defaultSuggestion: null },
  },
  missing_origin: {
    zh: { question: '你从哪个城市出发？', defaultSuggestion: null },
    en: { question: 'Which city are you departing from?', defaultSuggestion: null },
  },
  missing_days: {
    zh: { question: '你计划玩几天？', defaultSuggestion: '按 5 天规划' },
    en: { question: 'How many days are you planning?', defaultSuggestion: 'Plan for 5 days' },
  },
  missing_dates: {
    zh: { question: '你打算什么时候出发？', defaultSuggestion: null },
    en: { question: 'When are you planning to depart?', defaultSuggestion: null },
  },
  missing_budget: {
    zh: { question: '你的旅行预算大概是多少？', defaultSuggestion: null },
    en: { question: 'What is your approximate travel budget?', defaultSuggestion: null },
  },
  unclear_preference: {
    zh: { question: '能告诉我更多你的旅行偏好吗，比如喜欢自然风光还是城市体验？', defaultSuggestion: null },
    en: { question: 'Could you tell me more about your travel preferences, e.g. nature or city experiences?', defaultSuggestion: null },
  },
  other: {
    zh: { question: '你还有其他关于这次旅行的具体要求或问题吗？', defaultSuggestion: null },
    en: { question: 'Do you have any other specific requirements or questions about this trip?', defaultSuggestion: null },
  },
}

const SYSTEM_PROMPT_CLARIFIER = `You are a travel planning assistant. Ask the user about a missing field of their trip plan.
Constraints:
- One warm, conversational sentence, max 20 words
- Do NOT repeat information the user already provided
- Output only the question, no preamble or explanation
- Write the question in the requested output language`

const DEFAULT_FALLBACK: Record<string, ClarifyResult> = {
  zh: { question: '能告诉我更多关于这次旅行的信息吗？', defaultSuggestion: null },
  en: { question: 'Could you tell me more about this trip?', defaultSuggestion: null },
}

function getFallback(reason: ClarifyReason, language: string): ClarifyResult {
  const byReason = FALLBACKS[reason] ?? DEFAULT_FALLBACK
  return byReason[language] ?? byReason['zh'] ?? DEFAULT_FALLBACK['zh']
}

function pad(n: number): string { return n < 10 ? `0${n}` : `${n}` }
function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function defaultStartDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return formatDate(d)
}

function briefSummary(brief: Partial<TripBrief> | undefined): string {
  if (!brief) return 'none'
  const parts: string[] = []
  if (brief.destinations?.length) parts.push(`destinations: ${brief.destinations.join(', ')}`)
  if (brief.days) parts.push(`${brief.days} days`)
  if (brief.travelers && brief.travelers > 1) parts.push(`${brief.travelers} travelers`)
  if (brief.originCity) parts.push(`departing from ${brief.originCity}`)
  if (brief.travelDates?.start && brief.travelDates?.end) {
    parts.push(`travelDates: ${brief.travelDates.start} to ${brief.travelDates.end}`)
  }
  if (brief.preferences && brief.preferences.length > 0) {
    parts.push(`preferences: ${brief.preferences.join(', ')}`)
  }
  if (brief.pace) parts.push(`pace: ${brief.pace}`)
  return parts.join('; ') || 'none'
}

export async function generateClarification(
  messages: Message[],
  brief: Partial<TripBrief> | undefined,
  reason: ClarifyReason,
  language = 'zh',
): Promise<ClarifyResult> {
  const fieldLabel =
    reason === 'missing_destination' ? 'travel destination' :
    reason === 'missing_origin' ? 'departure city' :
    reason === 'missing_days' ? 'number of travel days' :
    reason === 'missing_dates' ? 'departure date' :
    reason === 'missing_budget' ? 'travel budget' :
    reason === 'unclear_preference' ? 'travel preferences' :
    'additional trip details'

  const userMessage =
    `Known trip info: ${briefSummary(brief)}\n` +
    `Missing field: ${fieldLabel}\n` +
    `Output language: ${language}\n` +
    `Generate the clarification question.`

  const fallback = getFallback(reason, language)
  let question: string = fallback.question
  try {
    const resp = await loggedCompletion('clarifier', {
      model: FAST_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT_CLARIFIER },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 60,
    })
    const raw = resp.choices[0]?.message?.content?.trim()
    if (raw) question = raw
  } catch (err) {
    console.warn('[Clarifier] LLM failed, using fallback:', err instanceof Error ? err.message : err)
  }

  let defaultSuggestion: string | null = fallback.defaultSuggestion
  if (reason === 'missing_dates') {
    const start = defaultStartDate()
    defaultSuggestion = language === 'zh'
      ? `按 ${start} 出发规划`
      : `Plan departure from ${start}`
  }

  return { question, defaultSuggestion }
}
