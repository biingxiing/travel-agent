import { FAST_MODEL } from '../llm/client.js'
import { loggedCompletion } from '../llm/logger.js'
import type { TripBrief, Message } from '@travel-agent/shared'

type ClarifyReason = 'missing_destination' | 'missing_days' | 'missing_dates'

interface ClarifyResult {
  question: string
  defaultSuggestion: string | null
}

const FALLBACKS: Record<ClarifyReason, Record<string, ClarifyResult>> = {
  missing_destination: {
    zh: { question: '你想去哪里旅行？', defaultSuggestion: null },
    en: { question: 'Where would you like to travel?', defaultSuggestion: null },
  },
  missing_days: {
    zh: { question: '你计划玩几天？', defaultSuggestion: '按 5 天规划' },
    en: { question: 'How many days are you planning?', defaultSuggestion: 'Plan for 5 days' },
  },
  missing_dates: {
    zh: { question: '你打算什么时候出发？', defaultSuggestion: null },
    en: { question: 'When are you planning to depart?', defaultSuggestion: null },
  },
}

function getFallback(reason: ClarifyReason, language: string): ClarifyResult {
  return FALLBACKS[reason][language] ?? FALLBACKS[reason]['zh']
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

function briefSummary(brief: Partial<TripBrief>): string {
  const parts: string[] = []
  if (brief.destinations?.length) parts.push(`destinations: ${brief.destinations.join(', ')}`)
  if (brief.days) parts.push(`${brief.days} days`)
  if (brief.travelers && brief.travelers > 1) parts.push(`${brief.travelers} travelers`)
  if (brief.originCity) parts.push(`departing from ${brief.originCity}`)
  return parts.join('; ') || 'none'
}

export async function generateClarification(
  messages: Message[],
  brief: Partial<TripBrief>,
  reason: ClarifyReason,
  language = 'zh',
): Promise<ClarifyResult> {
  const fieldLabel =
    reason === 'missing_destination' ? 'travel destination' :
    reason === 'missing_days' ? 'number of travel days' : 'departure date'

  const systemPrompt =
    `You are a travel planning assistant. Known trip info: ${briefSummary(brief)}. ` +
    `Missing field: ${fieldLabel}. ` +
    `Ask for this field in a warm, conversational single sentence (max 20 words). ` +
    `Do not repeat information the user already provided. Output only the question. ` +
    `IMPORTANT: Write the question in this language: ${language}.`

  const fallback = getFallback(reason, language)
  let question: string = fallback.question
  try {
    const resp = await loggedCompletion('clarifier', {
      model: FAST_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Generate the clarification question.' },
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
