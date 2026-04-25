import { randomUUID } from 'crypto'
import { llm, PLANNER_MODEL } from '../llm/client.js'
import { skillRegistry } from '../registry/skill-registry.js'
import { PlanSchema, type Plan, type Message, type ChatStreamEvent, type EvaluationReport, type TripBrief } from '@travel-agent/shared'
import type OpenAI from 'openai'
import type { SkillManifest } from '../registry/types.js'

const MAX_SKILL_ROUNDS = 4

const SYSTEM_PROMPT_INITIAL = `你是专业旅行规划师。基于 TripBrief、对话和（如果提供的）"真实数据上下文"生成完整 JSON 行程。

输入说明：
- system 消息中可能附带「真实航班/酒店/景点数据」。这些是已经调用过 flyai 拿到的真实结果。
- **不要再说"我无法实时查询"**——你已经拿到了真实数据，直接基于这些数据填 PlanItem。
- 如果某类数据没出现在 system 消息中（例如同城出行没有航班数据），就按一般常识合理安排，不要拒绝输出。
- 如确实需要补充查询，可以调用 flyai tool（command=search-flight / search-hotel / search-poi / search-train）；否则不必调用。

输出要求：
- 信息充足：先用 1-2 句自然语言告诉用户你在规划，然后另起一行输出 \`\`\`json 代码块（仅一个）。
- 信息不足时（destination/days 缺失）才用自然语言追问，不输出 JSON。
- **每天 dailyPlans[].items 至少 3 条且不得为空数组**。
- 必须包含：destinations 中每对相邻城市（含出发地↔第一城、末城↔出发地）的交通项。从 flyai 给出的机票和火车数据中各挑最优（考虑时长×票价），description 写：推荐方案（航班号/车次、起止站、时长、票价）并附一行"备选：XX 方案（XX 元/XX 小时）"。destinations 长度 > 1 时按游览顺序串联城市，每次换城在当天最后插一个 transport item。至少 1 个酒店项（真实酒店名 + 价格）、若干景点和餐饮。
- 景点 description 必须包含：开放时间(09:00-17:00 或全天)、门票(¥60/人 或 免费)、建议游览时长(2 小时)。
- 交通 description 写明航班号/车次、起止机场或车站、起降时间、票价。
- 酒店 description 写明酒店名、星级或类型、单晚价格。

JSON Schema 严格要求（很重要，否则会被拒绝）：
- 顶层字段：title, destinations（数组）, days, travelers, pace, dailyPlans, estimatedBudget, tips, disclaimer
- pace 取值只能是英文枚举：relaxed | balanced | packed
- 每个 dailyPlans[].items[].type **必须是英文枚举之一**：attraction | meal | transport | lodging | activity | note （不要写"交通"/"住宿"/"景点"等中文）
- 每个 item 必须有 type 和 title 两个字段
- estimatedBudget = { amount: 数字, currency: "CNY", breakdown: [{category: "transport"|"lodging"|"food"|"tickets"|"other", amount: 数字}] }
`

const SYSTEM_PROMPT_REFINE = `你是旅行行程修补师。根据 critic 报告，**只修补**问题项，**不要重写整个行程**。

要求：
- 输入是当前行程和评估报告
- 对每个 itemIssue：
  - suggestedAction = call_flyai_flight/train/hotel/poi → 调用 flyai skill 拿真实数据，再改 description
  - rewrite_description → 直接重写该 item.description（补开放时间/门票/时长 等）
  - replace_item → 替换为更合理的 item
  - reorder → 调整顺序
- 对 globalIssues：在合理范围内调整（如换景点）
- 输出**完整 plan JSON**（保留未改的部分），仅一个 \`\`\`json 代码块
`

function buildSkillTools(): OpenAI.Chat.ChatCompletionTool[] {
  return skillRegistry.list().map((m: SkillManifest) => ({
    type: 'function',
    function: {
      name: m.name,
      description: m.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(Object.entries(m.parameters ?? {}).map(([k, p]) =>
          [k, { type: p.type, description: p.description }])),
        required: Object.entries(m.parameters ?? {}).filter(([, p]) => p.required).map(([k]) => k),
        additionalProperties: false,
      },
    },
  }))
}

function extractJsonCodeBlock(content: string): string | null {
  const m = content.match(/```json\s*([\s\S]*?)\s*```/)
  return m?.[1] ?? null
}

function normalizePace(raw: unknown): 'relaxed' | 'balanced' | 'packed' | undefined {
  if (raw === 'relaxed' || raw === 'balanced' || raw === 'packed') return raw
  if (typeof raw !== 'string') return undefined
  if (/紧|密|高强|快|加速|大量/.test(raw)) return 'packed'
  if (/松|休闲|慢|宽|轻松|舒缓/.test(raw)) return 'relaxed'
  return 'balanced'
}

const ITEM_TYPE_MAP: Record<string, 'attraction' | 'meal' | 'transport' | 'lodging' | 'activity' | 'note'> = {
  attraction: 'attraction', meal: 'meal', transport: 'transport',
  lodging: 'lodging', activity: 'activity', note: 'note',
  '景点': 'attraction', '景区': 'attraction', '观光': 'attraction',
  '餐饮': 'meal', '美食': 'meal', '用餐': 'meal', '餐厅': 'meal',
  '交通': 'transport', '出行': 'transport', '航班': 'transport', '高铁': 'transport', '火车': 'transport',
  '住宿': 'lodging', '酒店': 'lodging', '入住': 'lodging',
  '活动': 'activity', '体验': 'activity',
  '备注': 'note', '提示': 'note',
}

function normalizePlanItem(item: Record<string, unknown>): Record<string, unknown> {
  const out = { ...item }
  if (typeof out.type === 'string' && !ITEM_TYPE_MAP[out.type]) {
    // Try fuzzy match on substring
    for (const [zh, en] of Object.entries(ITEM_TYPE_MAP)) {
      if ((out.type as string).includes(zh)) { out.type = en; break }
    }
  } else if (typeof out.type === 'string') {
    out.type = ITEM_TYPE_MAP[out.type]
  }
  if (typeof out.type !== 'string') out.type = 'activity'
  if (typeof out.title !== 'string' || !out.title) {
    out.title = typeof out.description === 'string' && out.description
      ? (out.description as string).slice(0, 40)
      : '未命名'
  }
  return out
}

// Normalize common LLM output drifts before zod parse.
function normalizePlanJson(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const obj = raw as Record<string, unknown>

  const normalizedPace = normalizePace(obj.pace)
  if (normalizedPace) obj.pace = normalizedPace
  else delete obj.pace  // let schema default kick in

  if (Array.isArray(obj.dailyPlans)) {
    obj.dailyPlans = (obj.dailyPlans as Array<Record<string, unknown>>).map((d) => ({
      ...d,
      items: Array.isArray(d.items)
        ? (d.items as Array<Record<string, unknown>>).map(normalizePlanItem)
        : [],
    }))
  }

  if (obj.estimatedBudget && typeof obj.estimatedBudget === 'object') {
    const b = obj.estimatedBudget as Record<string, unknown>
    if (typeof b.amount !== 'number') b.amount = 0
    if (typeof b.currency !== 'string') b.currency = 'CNY'
    // breakdown: LLM may emit object {transport: 1000, ...} instead of array
    if (b.breakdown && !Array.isArray(b.breakdown) && typeof b.breakdown === 'object') {
      b.breakdown = Object.entries(b.breakdown as Record<string, unknown>)
        .filter(([k]) => ['transport', 'lodging', 'food', 'tickets', 'other'].includes(k))
        .map(([category, amount]) => ({
          category,
          amount: typeof amount === 'number' ? amount : 0,
        }))
    }
  }

  if (!Array.isArray(obj.preferences)) obj.preferences = []
  if (!Array.isArray(obj.tips)) obj.tips = []
  if (typeof obj.travelers !== 'number') obj.travelers = 1
  if (typeof obj.disclaimer !== 'string') {
    obj.disclaimer = '本行程由 AI 生成，仅供参考。出行前请通过官方渠道核对最新信息。'
  }
  return obj
}

async function runWithToolLoop(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  tools: OpenAI.Chat.ChatCompletionTool[],
): Promise<{ content: string; messages: OpenAI.Chat.ChatCompletionMessageParam[] }> {
  let current = [...messages]
  for (let i = 0; i < MAX_SKILL_ROUNDS; i++) {
    const resp = await llm.chat.completions.create({
      model: PLANNER_MODEL, messages: current, tools, tool_choice: 'auto',
      temperature: 0.3, stream: false,
    })
    const msg = resp.choices[0]?.message
    if (!msg) return { content: '', messages: current }
    const calls = msg.tool_calls ?? []
    if (calls.length === 0) return { content: typeof msg.content === 'string' ? msg.content : '', messages: current }
    current.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls })
    for (const c of calls) {
      let out: string
      try {
        const args = c.function.arguments ? JSON.parse(c.function.arguments) : {}
        out = await skillRegistry.invoke(c.function.name, args as Record<string, unknown>)
      } catch (err) {
        out = JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
      }
      current.push({ role: 'tool', tool_call_id: c.id, content: out })
    }
  }
  return { content: '', messages: current }
}

export async function* runInitial(
  brief: TripBrief, messages: Message[], prefetchedContext: string[] = [],
): AsyncGenerator<ChatStreamEvent, Plan | null, void> {
  const messageId = randomUUID()
  const prefetchedMessages: OpenAI.Chat.ChatCompletionMessageParam[] = prefetchedContext.map(
    (content) => ({ role: 'system', content }),
  )
  const llmMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT_INITIAL },
    ...prefetchedMessages,
    { role: 'user', content: `TripBrief:\n${JSON.stringify(brief)}` },
    ...messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({
      role: m.role as 'user' | 'assistant', content: m.content,
    })),
  ]

  const tools = buildSkillTools()

  // Phase A: tool round (non-streaming) to gather real flyai data
  const prepared = await runWithToolLoop(llmMessages, tools)

  // Phase B: stream final NL + JSON
  const stream = await llm.chat.completions.create({
    model: PLANNER_MODEL,
    messages: [...prepared.messages, { role: 'system', content: '现在请基于上述 tool 结果生成最终行程，输出 NL + ```json 代码块。' }],
    tools, tool_choice: 'none',
    stream: true, stream_options: { include_usage: true }, temperature: 0.7,
  })

  let full = ''
  let nlBuf = ''
  let inJson = false
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? ''
    if (!delta) continue
    full += delta
    if (!inJson) {
      nlBuf += delta
      const start = nlBuf.indexOf('```json')
      if (start !== -1) {
        inJson = true
        const nlPart = nlBuf.slice(0, start).trimEnd()
        if (nlPart) yield { type: 'token', delta: nlPart }
        nlBuf = ''
      } else {
        const safe = nlBuf.length > 7 ? nlBuf.length - 7 : 0
        if (safe > 0) {
          yield { type: 'token', delta: nlBuf.slice(0, safe) }
          nlBuf = nlBuf.slice(safe)
        }
      }
    }
  }
  if (!inJson && nlBuf.trim()) yield { type: 'token', delta: nlBuf }

  const json = extractJsonCodeBlock(full)
  if (!json) {
    // No JSON → it's a clarification / refusal NL response
    yield { type: 'done', messageId }
    return null
  }
  try {
    const plan = PlanSchema.parse(normalizePlanJson(JSON.parse(json)))
    yield { type: 'plan', plan }
    yield { type: 'done', messageId }
    return plan
  } catch (err) {
    yield { type: 'error', code: 'PLAN_PARSE_FAILED', message: err instanceof Error ? err.message : String(err) }
    return null
  }
}

export async function runRefine(
  current: Plan, report: EvaluationReport, brief: TripBrief,
): Promise<Plan> {
  const llmMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT_REFINE },
    { role: 'user', content: [
      `TripBrief:\n${JSON.stringify(brief)}`,
      `\nCurrentPlan:\n${JSON.stringify(current)}`,
      `\nEvaluationReport:\n${JSON.stringify({
        combined: report.combined,
        itemIssues: report.itemIssues,
        globalIssues: report.globalIssues,
      })}`,
    ].join('\n') },
  ]
  const tools = buildSkillTools()
  const prepared = await runWithToolLoop(llmMessages, tools)
  const rawJson = extractJsonCodeBlock(prepared.content) ?? prepared.content
  const json = rawJson?.trim()
  if (!json || (json[0] !== '{' && json[0] !== '[')) {
    console.warn(`[Generator.refine] No JSON in LLM output (content length=${prepared.content?.length ?? 0}), returning original`)
    return current
  }
  try {
    return PlanSchema.parse(normalizePlanJson(JSON.parse(json)))
  } catch (err) {
    console.warn('[Generator.refine] Parse failed, returning original:', err)
    return current
  }
}
