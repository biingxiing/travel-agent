import { FAST_MODEL } from '../../llm/client.js'
import { loggedCompletion } from '../../llm/logger.js'
import type { Message } from '@travel-agent/shared'

export const COMPACT_THRESHOLD = 10
export const SLIDING_WINDOW = 20

const SYSTEM_PROMPT = `You compress a long travel-planning chat into one paragraph that preserves: destinations, dates, traveler count, declared preferences, hard constraints, anything the user explicitly said NO to. Drop greetings, filler, repetitions. Output one paragraph (≤ 200 Chinese chars / 100 English words). No headings, no bullet points.` as const

/**
 * Summarize earliest turns once and lock the result.
 * Returns existing summary unchanged if already set.
 * Returns null if no compaction needed.
 */
export async function compactHistoryIfNeeded(
  turns: Message[],
  existingSummary: string | null,
): Promise<string | null> {
  if (existingSummary) return existingSummary
  // count user+assistant turns
  const userAssistant = turns.filter((t) => t.role === 'user' || t.role === 'assistant')
  if (userAssistant.length <= COMPACT_THRESHOLD) return null

  // The block to summarize is everything outside the most-recent SLIDING_WINDOW
  const head = userAssistant.slice(0, Math.max(0, userAssistant.length - SLIDING_WINDOW))
  if (head.length === 0) return null

  const transcript = head.map((t) => `${t.role}: ${t.content}`).join('\n')
  try {
    const resp = await loggedCompletion('compactor', {
      model: FAST_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: transcript },
      ],
      temperature: 0.2,
      max_tokens: 320,
    })
    const out = resp.choices[0]?.message?.content?.trim()
    return out && out.length > 0 ? out : null
  } catch (err) {
    console.warn('[compactor] failed:', err instanceof Error ? err.message : err)
    return null
  }
}
