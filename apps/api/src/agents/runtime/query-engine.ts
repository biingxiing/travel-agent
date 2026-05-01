import type OpenAI from 'openai'
import type { SessionState } from '@travel-agent/shared'
import { PLANNER_MODEL } from '../../llm/client.js'
import { loggedStream } from '../../llm/logger.js'
import type { ToolPool } from './tool-pool.js'
import type { Trace } from './trace.js'

export interface QueryEngineOptions {
  persona: string
  pool: ToolPool
  session: SessionState
  runId: string
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
  trace: Trace
  model?: string
  temperature?: number
  maxTurns?: number
}

export interface RawToolCall { id: string; name: string; arguments: string; parseError?: string; input?: Record<string, unknown> }

export interface RunOutput {
  fullContent: string
  toolCalls: RawToolCall[]
  assistantMessage: OpenAI.Chat.ChatCompletionMessageParam
  cancelled: boolean
}

export class QueryEngine {
  constructor(public readonly opts: QueryEngineOptions) {}

  private isCancelled(): boolean {
    return this.opts.session.lastRunId !== this.opts.runId
  }

  /** Single LLM stream pass. Returns assistant message + tool_calls, or cancelled flag. */
  async run(): Promise<RunOutput> {
    const { persona, pool, messages, trace, model, temperature } = this.opts
    if (this.isCancelled()) {
      return {
        fullContent: '',
        toolCalls: [],
        assistantMessage: { role: 'assistant', content: '' },
        cancelled: true,
      }
    }

    trace.event({ agent: persona, event: 'llm_call_start', model: model ?? PLANNER_MODEL })

    let fullContent = ''
    const raw = new Map<number, { id: string; name: string; arguments: string }>()

    for await (const chunk of loggedStream(persona, {
      model: model ?? PLANNER_MODEL,
      messages,
      tools: pool.toOpenAITools(),
      tool_choice: 'auto',
      temperature: temperature ?? 0.3,
    })) {
      if (this.isCancelled()) break
      const delta = chunk.choices[0]?.delta
      if (!delta) continue
      if (delta.content) fullContent += delta.content
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0
          const e = raw.get(idx) ?? { id: '', name: '', arguments: '' }
          raw.set(idx, {
            id: tc.id || e.id,
            name: tc.function?.name || e.name,
            arguments: e.arguments + (tc.function?.arguments ?? ''),
          })
        }
      }
    }

    trace.event({ agent: persona, event: 'llm_call_end', contentLen: fullContent.length, toolCalls: raw.size })

    if (this.isCancelled()) {
      return { fullContent, toolCalls: [], assistantMessage: { role: 'assistant', content: '' }, cancelled: true }
    }

    const toolCalls: RawToolCall[] = Array.from(raw.entries())
      .sort(([a], [b]) => a - b)
      .map(([, tc]) => {
        try {
          return { ...tc, input: tc.arguments ? JSON.parse(tc.arguments) : {} }
        } catch (err) {
          return { ...tc, parseError: err instanceof Error ? err.message : String(err) }
        }
      })

    const assistantMessage: OpenAI.Chat.ChatCompletionMessageParam = toolCalls.length > 0
      ? {
        role: 'assistant',
        content: fullContent || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      }
      : { role: 'assistant', content: fullContent }

    return { fullContent, toolCalls, assistantMessage, cancelled: false }
  }
}
