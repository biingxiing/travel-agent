import { randomUUID } from 'crypto'
import { PLANNER_MODEL } from '../llm/client.js'
import { loggedCompletion, loggedStream } from '../llm/logger.js'
import { skillRegistry } from '../registry/skill-registry.js'
import {
  PlanSchema, type Plan, type ChatStreamEvent, type EvaluationReport, type TripBrief,
} from '@travel-agent/shared'
import type OpenAI from 'openai'
import type { SkillManifest } from '../registry/types.js'

const MAX_SKILL_ROUNDS = 4

// Static prefix — must be identical across calls for LLM prefix caching.
// Keep this const module-level so the string reference is stable.
const SYSTEM_PROMPT_INITIAL = `You are a professional travel planner. Based on the TripBrief and any prefetched real-world data provided in system messages, generate a complete JSON itinerary.

## Input Guidelines
- System messages may contain "Real flight/hotel/POI data". These are actual results already fetched via flyai. Use them directly when filling PlanItems.
- Do NOT say "I cannot check real-time" — real data has already been provided. Fill items from it directly.
- If a data type is missing (e.g., no flight data for local travel), use general knowledge. Do not refuse to output.
- If you need supplementary data, call a flyai tool (command: search-flight, search-hotel, search-poi, search-train). Otherwise skip the tool call.

## Output Format
- Start with 1–2 natural language sentences telling the user you are planning, then output exactly ONE \`\`\`json code block.
- If destinations or days are missing, ask in natural language; do not output JSON.
- Every day in dailyPlans[].items MUST contain at least 3 items. Empty arrays are invalid.

## Required Content Per Item Type

### Transport Items (type: "transport")
- Must include: flight or train number, departure/arrival stations or airports, departure/arrival times, ticket price.
- For every adjacent city pair (including origin↔first city, last city↔origin) insert one transport item.
- When both flight and train data are available, recommend the best option and mention the alternative.
- Description format: "Recommended: [number], [dep]→[arr], [time], ¥[price]. Alternative: [option], ¥[price] / [hours]h"
- On multi-destination trips insert a transport item at end of the day when switching cities.

### Lodging Items (type: "lodging")
- Must include: hotel name, star rating or property type, price per night.
- Use real hotel names from flyai data when available.

### Attraction Items (type: "attraction")
- Must include: opening hours (e.g. 09:00–17:00 or all-day), admission fee (e.g. ¥60/person or free), suggested visit duration (e.g. 2 hours).

### Meal Items (type: "meal")
- Include at least one meal per day with restaurant name or cuisine type and price range.

## JSON Schema (strict — violations cause parse rejection)
Top-level fields:
- title: string
- destinations: string[] — ordered by visit sequence
- days: number
- travelers: number
- pace: "relaxed" | "balanced" | "packed"  (English enum only — never Chinese)
- dailyPlans: Array<{ day: number, items: PlanItem[] }>
- estimatedBudget: { amount: number, currency: "CNY", breakdown: Array<{ category: "transport"|"lodging"|"food"|"tickets"|"other", amount: number }> }
- tips: string[]
- disclaimer: string

PlanItem fields:
- type: "attraction" | "meal" | "transport" | "lodging" | "activity" | "note"  (English enum only)
- title: string
- description: string — must meet requirements above per item type
- duration?: string
- cost?: number

## Quality Standards
- Budget total must be internally consistent with item prices.
- Do not repeat the same attraction or hotel across days.
- Group nearby attractions on the same day for geographic efficiency.
- Transport must connect the correct city pairs with realistic schedules.
- All prices should be reasonable for the destination and traveler count.
- Output all user-facing text (titles, descriptions, tips, disclaimer) in OUTPUT_LANGUAGE.`

const SYSTEM_PROMPT_REFINE = `You are a travel itinerary repair specialist. Fix ONLY the issues identified in the critic's EvaluationReport — do NOT rewrite the entire itinerary.

## Repair Instructions

For each itemIssue:
- suggestedAction = call_flyai_flight: call flyai search-flight using hints, then rewrite the transport item description with real data (flight number, route, time, price).
- suggestedAction = call_flyai_train: call flyai search-train using hints, then rewrite the transport item with real train data.
- suggestedAction = call_flyai_hotel: call flyai search-hotel using hints, then rewrite the lodging item with real hotel name and price.
- suggestedAction = call_flyai_poi: call flyai search-poi using hints, then enrich the attraction description.
- suggestedAction = rewrite_description: rewrite only the description field, adding the missing details (opening hours, admission, duration, hotel name, price per night).
- suggestedAction = replace_item: replace with a more appropriate item at the same position.
- suggestedAction = reorder: adjust item order within the day for logical flow.

For globalIssues: make targeted adjustments (e.g., swap a duplicate attraction, rebalance a packed day).

Preserve every item NOT mentioned in the report exactly as-is.

## Output
Output the COMPLETE repaired plan JSON (all days, all items including unchanged ones) — exactly ONE \`\`\`json code block. No prose before or after.

## Input You Will Receive
1. TripBrief — structured trip requirements
2. PrefetchContext — real-world data already retrieved for this session (for reference)
3. CurrentPlan — the plan to repair
4. EvaluationReport — itemIssues and globalIssues to address

Output all user-facing text in OUTPUT_LANGUAGE.`

// Build tool list once per process start — skill registry is static after bootstrap.
let _cachedTools: OpenAI.Chat.ChatCompletionTool[] | null = null
function buildSkillTools(): OpenAI.Chat.ChatCompletionTool[] {
  if (_cachedTools) return _cachedTools
  _cachedTools = skillRegistry.list().map((m: SkillManifest) => ({
    type: 'function',
    function: {
      name: m.name,
      description: m.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(m.parameters ?? {}).map(([k, p]) => [k, { type: p.type, description: p.description }]),
        ),
        required: Object.entries(m.parameters ?? {}).filter(([, p]) => p.required).map(([k]) => k),
        additionalProperties: false,
      },
    },
  }))
  return _cachedTools
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

function normalizePlanJson(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const obj = raw as Record<string, unknown>
  const normalizedPace = normalizePace(obj.pace)
  if (normalizedPace) obj.pace = normalizedPace
  else delete obj.pace
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
    const resp = await loggedCompletion('generator', {
      model: PLANNER_MODEL, messages: current, tools, tool_choice: 'auto',
      temperature: 0.3,
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

function resolveLanguageLabel(language: string): string {
  if (language === 'zh') return 'Chinese (Simplified)'
  if (language === 'en') return 'English'
  return language
}

// runInitial: receives only structured data — no raw chat history.
// TripBrief is the distilled intent; history is not needed by the generator.
export async function* runInitial(
  brief: TripBrief,
  prefetchedContext: string[] = [],
  language = 'zh',
): AsyncGenerator<ChatStreamEvent, Plan | null, void> {
  const messageId = randomUUID()
  const systemPrompt = SYSTEM_PROMPT_INITIAL.replace('OUTPUT_LANGUAGE', resolveLanguageLabel(language))

  const prefetchedMessages: OpenAI.Chat.ChatCompletionMessageParam[] = prefetchedContext.map(
    (content) => ({ role: 'system' as const, content }),
  )
  const llmMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...prefetchedMessages,
    { role: 'user', content: `TripBrief:\n${JSON.stringify(brief)}` },
  ]

  const tools = buildSkillTools()
  const prepared = await runWithToolLoop(llmMessages, tools)

  let full = ''
  let nlBuf = ''
  let inJson = false
  for await (const chunk of loggedStream('generator', {
    model: PLANNER_MODEL,
    messages: [
      ...prepared.messages,
      { role: 'system', content: 'Generate the final itinerary now: natural language intro + ```json code block.' },
    ],
    tools, tool_choice: 'none',
    temperature: 0.7,
  })) {
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

// runRefine: receives structured data only — no raw chat history.
// Reuses prefetchContext from the session to avoid redundant flyai calls.
export async function runRefine(
  current: Plan,
  report: EvaluationReport,
  brief: TripBrief,
  prefetchContext: string[] = [],
  language = 'zh',
): Promise<Plan> {
  const systemPrompt = SYSTEM_PROMPT_REFINE.replace('OUTPUT_LANGUAGE', resolveLanguageLabel(language))

  // Static prefix first (cacheable), then current task instruction last.
  const prefetchMessages: OpenAI.Chat.ChatCompletionMessageParam[] = prefetchContext.map(
    (content) => ({ role: 'user' as const, content: `[Prefetch data for reference]\n${content}` }),
  )
  const llmMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...prefetchMessages,
    {
      role: 'user',
      content: [
        `TripBrief:\n${JSON.stringify(brief)}`,
        `\nCurrentPlan:\n${JSON.stringify(current)}`,
        `\nEvaluationReport:\n${JSON.stringify({
          combined: report.combined,
          itemIssues: report.itemIssues,
          globalIssues: report.globalIssues,
        })}`,
      ].join('\n'),
    },
  ]

  const tools = buildSkillTools()
  const prepared = await runWithToolLoop(llmMessages, tools)
  const rawJson = extractJsonCodeBlock(prepared.content) ?? prepared.content
  const json = rawJson?.trim()
  if (!json || (json[0] !== '{' && json[0] !== '[')) {
    console.warn(`[Generator.refine] No JSON in output (len=${prepared.content?.length ?? 0}), returning original`)
    return current
  }
  try {
    return PlanSchema.parse(normalizePlanJson(JSON.parse(json)))
  } catch (err) {
    console.warn('[Generator.refine] Parse failed, returning original:', err)
    return current
  }
}
