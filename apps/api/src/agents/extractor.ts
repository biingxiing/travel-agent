import { z } from 'zod'
import { llm, FAST_MODEL } from '../llm/client.js'
import { TripBriefSchema, type TripBrief } from '@travel-agent/shared'
import type { Message } from '@travel-agent/shared'
import type OpenAI from 'openai'

const IntentEnum = z.enum(['new', 'refine', 'clarify-answer', 'continue'])
export type ExtractIntent = z.infer<typeof IntentEnum>

const ExtractorOutputSchema = z.object({
  brief: TripBriefSchema.partial(),
  intent: IntentEnum,
  changedFields: z.array(z.string()).default([]),
})
export type ExtractorOutput = z.infer<typeof ExtractorOutputSchema>

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

  const resp = await llm.chat.completions.create({
    model: FAST_MODEL,
    messages: llmMessages,
    temperature: 0,
    response_format: { type: 'json_object' },
  })

  const content = resp.choices[0]?.message?.content ?? '{}'
  const parsed = ExtractorOutputSchema.parse(JSON.parse(content))

  // Merge partial with existing, then strict-validate
  const merged = {
    ...(existingBrief ?? {}),
    ...parsed.brief,
    travelers: parsed.brief.travelers ?? existingBrief?.travelers ?? 1,
    preferences: parsed.brief.preferences ?? existingBrief?.preferences ?? [],
    destination: parsed.brief.destination ?? existingBrief?.destination ?? '',
    days: parsed.brief.days ?? existingBrief?.days ?? 0,
  }
  const brief = TripBriefSchema.parse(merged)

  return { brief, intent: parsed.intent, changedFields: parsed.changedFields }
}
