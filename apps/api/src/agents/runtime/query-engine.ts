import type OpenAI from 'openai'
import type { SessionState } from '@travel-agent/shared'
import { PLANNER_MODEL } from '../../llm/client.js'
import { loggedStream } from '../../llm/logger.js'
import type { ToolPool, EmitFn } from './tool-pool.js'
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

  async dispatchToolCalls(
    calls: RawToolCall[],
    emit: EmitFn,
  ): Promise<{ toolResultMessages: OpenAI.Chat.ChatCompletionMessageParam[]; halt: boolean }> {
    const { pool, session, trace, persona } = this.opts

    interface BatchedCall { concurrent: boolean; calls: RawToolCall[] }
    const partitioned: BatchedCall[] = []
    let acc: RawToolCall[] = []
    for (const c of calls) {
      const tool = pool.find(c.name)
      if (tool?.isConcurrencySafe()) {
        acc.push(c)
      } else {
        if (acc.length > 0) { partitioned.push({ concurrent: true, calls: acc }); acc = [] }
        partitioned.push({ concurrent: false, calls: [c] })
      }
    }
    if (acc.length > 0) partitioned.push({ concurrent: true, calls: acc })

    const runOne = async (c: RawToolCall): Promise<{ id: string; output: string; halt: boolean }> => {
      if (c.parseError) {
        return { id: c.id, output: `Error: invalid JSON arguments — ${c.parseError}.`, halt: false }
      }
      const tool = pool.find(c.name)
      if (!tool) return { id: c.id, output: `Error: unknown tool "${c.name}"`, halt: false }
      trace.event({ agent: persona, event: 'tool_call', tool: c.name, args: c.input })
      try {
        const r = await tool.call(c.input ?? {}, session, emit)
        if (r.type === 'halt') {
          trace.event({ agent: persona, event: 'tool_halt', tool: c.name, reason: r.reason })
          return { id: c.id, output: 'Clarification requested.', halt: true }
        }
        trace.event({ agent: persona, event: 'tool_result', tool: c.name })
        return { id: c.id, output: r.output, halt: false }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        trace.event({ agent: persona, event: 'tool_error', tool: c.name, error: msg })
        return { id: c.id, output: `Tool error: ${msg}`, halt: false }
      }
    }

    const results: { id: string; output: string; halt: boolean }[] = []
    for (const batch of partitioned) {
      if (batch.concurrent) {
        results.push(...await Promise.all(batch.calls.map(runOne)))
      } else {
        for (const c of batch.calls) results.push(await runOne(c))
      }
    }
    return {
      halt: results.some((r) => r.halt),
      toolResultMessages: results.map((r) => ({ role: 'tool' as const, tool_call_id: r.id, content: r.output })),
    }
  }
}
