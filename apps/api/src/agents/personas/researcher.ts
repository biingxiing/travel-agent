import { z } from 'zod'
import type OpenAI from 'openai'
import { TripBriefSchema } from '@travel-agent/shared'
import { ToolPool } from '../runtime/tool-pool.js'
import { prefetchContextTool } from '../tools/researcher/prefetch-context.tool.js'

export const SYSTEM_PROMPT = `You are a travel research subagent. Your sole job is to gather concrete real-world data needed to plan a trip.

You receive a JSON payload with a TripBrief and a list of researchGoals (e.g. "transport", "weather", "hotels", "attractions"). For each goal you must:
1. Use the tools available in your tool pool to query the relevant data sources.
2. Aggregate the results into a single, dense summary the planner can quote from.
3. Cite which tool produced each fact so the planner can trace claims.

Output rules (STRICT):
- Your final assistant message MUST be a single fenced JSON code block (\`\`\`json … \`\`\`).
- The JSON must match this shape exactly:
  - On success: { "ok": true, "summary": string, "sources": string[] }
  - On unrecoverable failure: { "ok": false, "error": string }
- summary should be 200–600 words, structured by goal. Cite source ids in line.
- sources is the list of tool/source identifiers you actually used.
- Do NOT include prose outside the JSON block. Do NOT add markdown headers outside the block.
- If a goal cannot be answered after one tool attempt, note it inside summary; do not loop indefinitely.` as const

export const InputSchema = z.object({
  brief: TripBriefSchema,
  researchGoals: z.array(z.string()).min(1),
  depth: z.enum(['fast', 'standard']).default('standard'),
})
export type Input = z.infer<typeof InputSchema>

export const OutputSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), summary: z.string(), sources: z.array(z.string()) }),
  z.object({ ok: z.literal(false), error: z.string() }),
])
export type Output = z.infer<typeof OutputSchema>

export function buildMessages(input: Input): OpenAI.Chat.ChatCompletionMessageParam[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(input) },
  ]
}

export const TOOLS = new ToolPool([prefetchContextTool])

import { registerPersona } from '../runtime/send-message.js'

registerPersona({
  name: 'researcher',
  systemPrompt: SYSTEM_PROMPT,
  InputSchema,
  OutputSchema,
  buildMessages,
  tools: TOOLS,
})
