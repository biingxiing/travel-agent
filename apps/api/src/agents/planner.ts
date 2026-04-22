import { randomUUID } from 'crypto'
import { llm, PLANNER_MODEL } from '../llm/client.js'
import { skillRegistry } from '../registry/skill-registry.js'
import { ItemSelectionSchema, PlanSchema } from '@travel-agent/shared'
import type { ChatStreamEvent, ItemSelection, Message, Plan, PlanItem } from '@travel-agent/shared'
import type { SkillManifest } from '../registry/types.js'
import type OpenAI from 'openai'

const SYSTEM_PROMPT = `你是一位专业的旅行规划师 AI。根据用户的需求，生成详细的旅行规划。

规划要求：
- 已提供可选 skill。只有在 skill 能补充用户明确需要的信息时才调用；如果不需要，就直接回答
- 如果要调用 skill，先完成 skill 调用，再输出最终自然语言和 JSON，不要把 skill 调用过程暴露给用户
- 信息充足时，先用 1-2 句自然语言告诉用户你在帮他规划（不含 JSON），然后另起一行输出 \`\`\`json 代码块
- 信息不足时，只用自然语言追问关键信息（目的地、天数、人数），不要返回 JSON
- 行程每天至少包含 3 个活动
- 给出预算估算（人民币）
- 景点类条目（type 为 "attraction" 或 "activity"）的 description 必须一次性写完整，并明确包含：
  - 开放时间（格式如：09:00-17:00 或 全天开放）
  - 门票价格（如：¥60/人 或 免费开放）
  - 建议游览时长（如：建议游览 2 小时）
- 交通和住宿条目如果缺少真实预订信息，不要编造具体航班号、车次号、酒店房型；可以先写通用安排，后续会补充用户可选方案
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

const OPTION_GENERATOR_PROMPT = `你是旅游预订顾问。根据已生成的行程，为指定的交通和住宿条目各提供 3 个真实风格的可选方案。

输出要求（仅输出 \`\`\`json ... \`\`\`，不含其他内容）：
{
  "selections": [
    {
      "dayNum": 数字,
      "itemIndex": 数字,
      "itemTitle": "条目标题",
      "itemType": "transport" 或 "lodging",
      "question": "中文问句，如：请选择第1天北京→上海的交通方式",
      "options": [
        {
          "id": "唯一字符串",
          "label": "简短标签，如：CA1234 · 经济舱 · ¥890",
          "description": "完整描述，含所有关键信息",
          "patch": {
            "description": "写入 PlanItem.description 的完整内容",
            "time": "HH:MM（可选）",
            "estimatedCost": { "amount": 数字, "currency": "CNY" }
          }
        }
      ]
    }
  ]
}

交通方案：包含航班/车次号（CA1234、G1234 格式）、出发/到达站全名、时间、舱位类型，三个选项价格档次不同。
住宿方案：包含酒店名、具体房型（大床房/双床房等）、入住 14:00 后 / 退房 12:00 前、每晚价格，三个选项档次不同。`

const TRANSPORT_CODE_PATTERN = /\b(?:[A-Z]{2}\d{3,4}|[GDZKTYJ]\d{2,4}次?)\b/i
const ROOM_TYPE_PATTERN = /大床房|双床房|标准间|单人间|套房|King|Queen|Twin|Suite/i
const MAX_SKILL_CALL_ROUNDS = 4

function findItemsNeedingOptions(
  plan: Plan,
): Array<{ dayNum: number; itemIndex: number; item: PlanItem }> {
  const result: Array<{ dayNum: number; itemIndex: number; item: PlanItem }> = []

  for (const day of plan.dailyPlans) {
    day.items.forEach((item, itemIndex) => {
      const text = [item.title, item.description ?? ''].join(' ')

      if (item.type === 'transport' && !TRANSPORT_CODE_PATTERN.test(text)) {
        result.push({ dayNum: day.day, itemIndex, item })
      }

      if (item.type === 'lodging' && !ROOM_TYPE_PATTERN.test(text)) {
        result.push({ dayNum: day.day, itemIndex, item })
      }
    })
  }

  return result
}

function messageContentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((part: unknown) => {
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
        return part.text
      }
      return ''
    })
    .join('')
}

function extractJsonCodeBlock(content: string): string | null {
  const match = content.match(/```json\s*([\s\S]*?)\s*```/)
  return match?.[1] ?? null
}

function buildSkillParametersSchema(manifest: SkillManifest): Record<string, unknown> {
  const properties: Record<string, Record<string, unknown>> = {}
  const required: string[] = []

  for (const [name, parameter] of Object.entries(manifest.parameters ?? {})) {
    properties[name] = {
      type: parameter.type,
      description: parameter.description,
    }

    if (parameter.required) required.push(name)
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }
}

function buildSkillTools(): OpenAI.Chat.ChatCompletionTool[] {
  return skillRegistry.list().map((manifest) => ({
    type: 'function',
    function: {
      name: manifest.name,
      description: manifest.description,
      parameters: buildSkillParametersSchema(manifest),
    },
  }))
}

function parseToolArguments(rawArguments: string): Record<string, unknown> {
  if (!rawArguments.trim()) return {}

  const parsed: unknown = JSON.parse(rawArguments)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Tool arguments must be a JSON object')
  }

  return parsed as Record<string, unknown>
}

function formatLogValue(value: unknown): string {
  const serialized = JSON.stringify(value)
  if (!serialized) return 'null'
  return serialized.length > 400 ? `${serialized.slice(0, 397)}...` : serialized
}

function extractVisibleAssistantText(content: string): string {
  const jsonStart = content.indexOf('```json')
  if (jsonStart === -1) return content
  return content.slice(0, jsonStart).trimEnd()
}

async function prepareMessagesWithSkillCalls(
  baseMessages: OpenAI.Chat.ChatCompletionMessageParam[],
  tools: OpenAI.Chat.ChatCompletionTool[],
): Promise<{
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
  finalContent: string | null
  promptTokens: number
  completionTokens: number
}> {
  let currentMessages = [...baseMessages]
  let promptTokens = 0
  let completionTokens = 0

  for (let round = 0; round < MAX_SKILL_CALL_ROUNDS; round += 1) {
    const response = await llm.chat.completions.create({
      model: PLANNER_MODEL,
      messages: currentMessages,
      tools,
      tool_choice: 'auto',
      stream: false,
      temperature: 0.3,
    })

    promptTokens += response.usage?.prompt_tokens ?? 0
    completionTokens += response.usage?.completion_tokens ?? 0

    const assistantMessage = response.choices[0]?.message
    if (!assistantMessage) {
      return { messages: currentMessages, finalContent: '', promptTokens, completionTokens }
    }

    const toolCalls = assistantMessage.tool_calls ?? []
    if (toolCalls.length === 0) {
      return {
        messages: currentMessages,
        finalContent: messageContentToText(assistantMessage.content ?? ''),
        promptTokens,
        completionTokens,
      }
    }

    currentMessages = [
      ...currentMessages,
      {
        role: 'assistant',
        content: assistantMessage.content ?? null,
        tool_calls: toolCalls,
      },
    ]

    for (const toolCall of toolCalls) {
      const skillName = toolCall.function.name
      let toolOutput: string

      try {
        const skillArgs = parseToolArguments(toolCall.function.arguments)
        console.log(
          `[Planner] LLM requested skill: ${skillName} args=${formatLogValue(skillArgs)}`,
        )
        toolOutput = await skillRegistry.invoke(skillName, skillArgs)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[Planner] Skill request failed: ${skillName} error=${message}`)
        toolOutput = JSON.stringify({ error: message })
      }

      console.log(`[Planner] Skill result: ${skillName} output=${formatLogValue(toolOutput)}`)
      currentMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolOutput,
      })
    }
  }

  return {
    messages: currentMessages,
    finalContent: null,
    promptTokens,
    completionTokens,
  }
}

async function generateItemOptions(
  plan: Plan,
  targets: Array<{ dayNum: number; itemIndex: number; item: PlanItem }>,
): Promise<ItemSelection[] | null> {
  if (targets.length === 0) return null

  const targetDesc = targets
    .map((target) =>
      `dayNum=${target.dayNum}, itemIndex=${target.itemIndex}, title="${target.item.title}", type=${target.item.type}`,
    )
    .join('\n')

  const userMsg = `行程如下：
\`\`\`json
${JSON.stringify(plan, null, 2)}
\`\`\`

需要生成选项的条目：
${targetDesc}`

  const resp = await llm.chat.completions.create({
    model: PLANNER_MODEL,
    messages: [
      { role: 'system', content: OPTION_GENERATOR_PROMPT },
      { role: 'user', content: userMsg },
    ],
    stream: false,
    temperature: 0.5,
  })

  const content = messageContentToText(resp.choices[0]?.message?.content ?? '')
  const json = extractJsonCodeBlock(content)
  if (!json) return null

  const parsed = JSON.parse(json) as { selections?: unknown[] }
  return ItemSelectionSchema.array().parse(parsed.selections ?? [])
}

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
  let finalMessages = openaiMessages
  let preparedContent: string | null = null
  let shouldDisableFurtherToolCalls = false

  const skillTools = buildSkillTools()
  if (skillTools.length > 0) {
    try {
      const prepared = await prepareMessagesWithSkillCalls(openaiMessages, skillTools)
      finalMessages = prepared.messages
      preparedContent = prepared.finalContent
      promptTokens += prepared.promptTokens
      completionTokens += prepared.completionTokens
      shouldDisableFurtherToolCalls = true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[Planner] Skill preparation failed, fallback to direct completion: ${message}`)
    }
  }

  let fullContent = ''
  if (preparedContent !== null) {
    fullContent = preparedContent
    const visibleText = extractVisibleAssistantText(fullContent)
    if (visibleText.trim()) {
      yield { type: 'token', delta: visibleText }
    }
  } else {
    const stream = await llm.chat.completions.create({
      model: PLANNER_MODEL,
      messages: finalMessages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.7,
      ...(shouldDisableFurtherToolCalls ? { tool_choice: 'none' as const } : {}),
    })

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
        promptTokens += chunk.usage.prompt_tokens
        completionTokens += chunk.usage.completion_tokens
      }
    }

    // Flush remaining NL buffer if never entered JSON mode
    if (!inJson && nlBuffer.trim()) {
      yield { type: 'token', delta: nlBuffer }
    }
  }

  yield { type: 'agent_step', agent: 'planner', status: 'done' }

  // Extract and emit plan if JSON was returned
  const jsonMatch = fullContent.match(/```json\s*([\s\S]*?)\s*```/)
  if (jsonMatch) {
    try {
      const plan = PlanSchema.parse(JSON.parse(jsonMatch[1]))
      yield { type: 'plan', plan }

      const targets = findItemsNeedingOptions(plan)
      if (targets.length > 0) {
        try {
          yield { type: 'agent_step', agent: 'optimizer', status: 'thinking' }
          const selections = await generateItemOptions(plan, targets)
          yield { type: 'agent_step', agent: 'optimizer', status: 'done' }
          if (selections && selections.length > 0) {
            yield { type: 'item_options', selections }
          }
        } catch {
          // Silent degrade: the initial plan has already been shown to the user.
        }
      }
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
