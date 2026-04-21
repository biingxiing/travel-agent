import { randomUUID } from 'crypto'
import { llm, PLANNER_MODEL } from '../llm/client.js'
import type { ChatStreamEvent, Message } from '@travel-agent/shared'
import type OpenAI from 'openai'

const SYSTEM_PROMPT = `你是一位专业的旅行规划师 AI。根据用户的需求，生成详细的旅行规划。

规划要求：
- 信息充足时，先用 1-2 句自然语言告诉用户你在帮他规划（不含 JSON），然后另起一行输出 \`\`\`json 代码块
- 信息不足时，只用自然语言追问关键信息（目的地、天数、人数），不要返回 JSON
- 行程每天至少包含 3 个活动
- 给出预算估算（人民币）
- 结尾必须包含免责声明字段

JSON 格式（严格遵守）：
{
  "title": "行程标题",
  "destination": "目的地",
  "originCity": "出发城市（可选）",
  "days": 天数,
  "travelers": 人数,
  "pace": "relaxed|balanced|packed",
  "preferences": [],
  "dailyPlans": [
    {
      "day": 1,
      "theme": "当天主题",
      "items": [
        {
          "time": "09:00",
          "type": "attraction|meal|transport|lodging|activity|note",
          "title": "名称",
          "description": "描述",
          "tips": ["贴士"]
        }
      ]
    }
  ],
  "estimatedBudget": {
    "amount": 总额,
    "currency": "CNY",
    "note": "预算说明",
    "breakdown": [
      { "category": "transport|lodging|food|tickets|other", "amount": 金额 }
    ]
  },
  "tips": ["注意事项"],
  "disclaimer": "本行程由 AI 生成，仅供参考。出行前请通过官方渠道核对最新信息。"
}

如果信息不足，直接用自然语言追问，不要返回 JSON。`

export async function* runPlannerAgent(
  messages: Message[],
): AsyncGenerator<ChatStreamEvent> {
  const messageId = randomUUID()

  yield { type: 'agent_step', agent: 'planner', status: 'thinking' }

  const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
  ]

  yield { type: 'agent_step', agent: 'planner', status: 'start' }

  let promptTokens = 0
  let completionTokens = 0

  const stream = await llm.chat.completions.create({
    model: PLANNER_MODEL,
    messages: openaiMessages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.7,
  })

  let fullContent = ''
  let nlBuffer = ''
  let inJson = false

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? ''
    if (delta) {
      fullContent += delta
      if (!inJson) {
        nlBuffer += delta
        // Detect start of JSON block; flush any NL text before it
        const jsonStart = nlBuffer.indexOf('```json')
        if (jsonStart !== -1) {
          inJson = true
          const nlPart = nlBuffer.slice(0, jsonStart).trimEnd()
          if (nlPart) yield { type: 'token', delta: nlPart }
          nlBuffer = ''
        } else {
          // Emit NL tokens up to a safe lookahead to avoid splitting the marker
          const safe = nlBuffer.length > 7 ? nlBuffer.length - 7 : 0
          if (safe > 0) {
            yield { type: 'token', delta: nlBuffer.slice(0, safe) }
            nlBuffer = nlBuffer.slice(safe)
          }
        }
      }
    }
    if (chunk.usage) {
      promptTokens = chunk.usage.prompt_tokens
      completionTokens = chunk.usage.completion_tokens
    }
  }

  // Flush remaining NL buffer if never entered JSON mode
  if (!inJson && nlBuffer.trim()) {
    yield { type: 'token', delta: nlBuffer }
  }

  yield { type: 'agent_step', agent: 'planner', status: 'done' }

  // Extract and emit plan if JSON was returned
  const jsonMatch = fullContent.match(/```json\s*([\s\S]*?)\s*```/)
  if (jsonMatch) {
    try {
      const plan = JSON.parse(jsonMatch[1])
      yield { type: 'plan', plan }
    } catch {
      // Clarifying question — no structured plan
    }
  }

  yield {
    type: 'done',
    messageId,
    usage: promptTokens > 0
      ? { prompt: promptTokens, completion: completionTokens }
      : undefined,
  }
}
