import { FAST_MODEL } from '../llm/client.js'
import { loggedCompletion } from '../llm/logger.js'
import { CriticReportSchema, type CriticReport, type Plan, type TripBrief } from '@travel-agent/shared'
import type OpenAI from 'openai'

const SYSTEM_PROMPT = `你是旅行行程评审员。读取一份 Plan 和 TripBrief，按以下维度判断问题：

【blocker】（关键信息缺失，必须先问用户才能继续）：
- missing_origin：跨城旅行但缺出发城市
- missing_dates：缺具体日期但行程依赖（如查航班/酒店）
- missing_budget：用户未给预算且行程档次模糊
- unclear_preference：偏好（美食/文化/户外）模糊导致景点选择无依据
- other：其他必须澄清的关键信息

【itemIssue】（具体某一天某一项的问题）：
- transport 类：缺航班/车次号 → call_flyai_flight 或 call_flyai_train
- lodging 类：缺具体酒店/房型 → call_flyai_hotel
- attraction 类：描述空泛（缺开放时间/门票/时长）→ rewrite_description
- 重复或不合理 → replace_item
- 顺序不顺路 → reorder
severity: high (评分 < 50) | medium (50-79) | low (≥80)

【globalIssue】（全局问题）：景点重复、节奏失衡、主题割裂等。

输出 JSON（仅一个对象，无 markdown）：
{
  "qualityScore": 0-100,
  "blockers": [{ "type": "...", "message": "中文问句" }],
  "itemIssues": [{
    "dayNum": 数字, "itemIndex": 数字, "severity": "high|medium|low",
    "category": "transport|lodging|attraction|meal|coherence",
    "problem": "...", "suggestedAction": "...",
    "hints": { /* 可选：调 flyai 时的参数提示 */ }
  }],
  "globalIssues": ["..."]
}`

const FALLBACK: CriticReport = {
  qualityScore: 0, blockers: [], itemIssues: [], globalIssues: [],
}

export async function criticReview(plan: Plan, brief: TripBrief): Promise<CriticReport> {
  const llmMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `TripBrief:\n${JSON.stringify(brief)}\n\nPlan:\n${JSON.stringify(plan)}`,
    },
  ]

  let resp
  try {
    resp = await loggedCompletion('critic', {
      model: FAST_MODEL,
      messages: llmMessages,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    })
  } catch (err) {
    console.warn('[Critic] LLM call failed:', err instanceof Error ? err.message : err)
    return FALLBACK
  }

  const raw = resp.choices[0]?.message?.content ?? '{}'
  try {
    return CriticReportSchema.parse(JSON.parse(raw || '{}'))
  } catch (err) {
    console.warn(`[Critic] Parse failed (raw="${raw.slice(0, 200).replace(/\n/g, '\\n')}"):`, err instanceof Error ? err.message : err)
    return FALLBACK
  }
}
