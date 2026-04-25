import { llm, FAST_MODEL } from '../llm/client.js'
import type { TripBrief, Message } from '@travel-agent/shared'

type ClarifyReason = 'missing_destination' | 'missing_days' | 'missing_dates'

interface ClarifyResult {
  question: string
  defaultSuggestion: string | null
}

const FALLBACKS: Record<ClarifyReason, ClarifyResult> = {
  missing_destination: { question: '你想去哪里旅行？', defaultSuggestion: null },
  missing_days: { question: '你计划玩几天？', defaultSuggestion: '按 5 天规划' },
  missing_dates: { question: '你打算什么时候出发？', defaultSuggestion: null },
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
  if (brief.destinations?.length) parts.push(`目的地：${brief.destinations.join('、')}`)
  if (brief.days) parts.push(`${brief.days} 天`)
  if (brief.travelers && brief.travelers > 1) parts.push(`${brief.travelers} 人`)
  if (brief.originCity) parts.push(`从${brief.originCity}出发`)
  return parts.join('，') || '暂无'
}

export async function generateClarification(
  messages: Message[],
  brief: Partial<TripBrief>,
  reason: ClarifyReason,
): Promise<ClarifyResult> {
  const fieldLabel =
    reason === 'missing_destination' ? '目的地' :
    reason === 'missing_days' ? '出行天数' : '出发日期'

  const systemPrompt =
    `你是旅行规划助手。用户已知信息：${briefSummary(brief)}。` +
    `缺失字段：${fieldLabel}。` +
    `用一句口语化、温暖的中文问出这个字段。不超过20字，不重复用户已说过的内容。只输出问句。`

  let question: string = FALLBACKS[reason].question
  try {
    const resp = await llm.chat.completions.create({
      model: FAST_MODEL,
      messages: [{ role: 'system', content: systemPrompt }],
      temperature: 0.7,
      max_tokens: 60,
    })
    const raw = resp.choices[0]?.message?.content?.trim()
    if (raw) question = raw
  } catch (err) {
    console.warn('[Clarifier] LLM failed, using fallback:', err instanceof Error ? err.message : err)
  }

  let defaultSuggestion: string | null = FALLBACKS[reason].defaultSuggestion
  if (reason === 'missing_dates') {
    const start = defaultStartDate()
    defaultSuggestion = `按 ${start} 出发规划`
  }

  return { question, defaultSuggestion }
}
