import type { z } from 'zod'
import type OpenAI from 'openai'
import type { SessionState } from '@travel-agent/shared'
import { QueryEngine } from './query-engine.js'
import type { ToolPool } from './tool-pool.js'
import type { Trace } from './trace.js'

export interface PersonaDef<I, O> {
  name: string
  systemPrompt: string
  InputSchema: z.ZodType<I>
  OutputSchema: z.ZodType<O>
  buildMessages: (input: I) => OpenAI.Chat.ChatCompletionMessageParam[]
  tools: ToolPool
  /** Max sub-loop turns; default 6 (researcher only invokes ~2 tool batches). */
  maxTurns?: number
}

const REGISTRY = new Map<string, PersonaDef<unknown, unknown>>()

export function registerPersona<I, O>(def: PersonaDef<I, O>): void {
  REGISTRY.set(def.name, def as unknown as PersonaDef<unknown, unknown>)
}

export function __resetPersonas(): void { REGISTRY.clear() }

export interface SendMessageContext {
  session: SessionState
  parentRunId: string
  parentPersona: string
  trace: Trace
  childIndex: number
}

const NOOP_EMIT = async (): Promise<void> => {}

export async function sendMessage<I, O>(
  targetPersona: string,
  rawInput: I,
  ctx: SendMessageContext,
): Promise<O> {
  const def = REGISTRY.get(targetPersona) as PersonaDef<I, O> | undefined
  if (!def) throw new Error(`Unknown persona: ${targetPersona}`)

  const input = def.InputSchema.parse(rawInput) as I
  const childAgentName = `${targetPersona}#${ctx.childIndex}`

  ctx.trace.event({
    agent: childAgentName, event: 'spawn',
    parent: ctx.parentPersona, input: input as unknown,
  })

  const messages = def.buildMessages(input)
  let workingMessages = messages
  const maxTurns = def.maxTurns ?? 6
  let final = ''

  for (let turn = 0; turn < maxTurns; turn++) {
    const engine = new QueryEngine({
      persona: childAgentName,
      pool: def.tools,
      session: ctx.session,
      runId: ctx.parentRunId,             // share parent runId so cancellation propagates
      messages: workingMessages,
      trace: ctx.trace,
    })
    const r = await engine.run()
    if (r.cancelled) throw new Error('cancelled')
    if (r.toolCalls.length === 0) { final = r.fullContent; break }
    const tr = await engine.dispatchToolCalls(r.toolCalls, NOOP_EMIT)
    workingMessages = [...workingMessages, r.assistantMessage, ...tr.toolResultMessages]
  }

  // Subagent must return JSON. Parse and validate.
  const json = (() => {
    const m = final.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    return (m?.[1] ?? final).trim()
  })()

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (err) {
    ctx.trace.event({ agent: childAgentName, event: 'return', ok: false, error: 'invalid_json' })
    throw new Error(`Subagent ${targetPersona} did not return valid JSON: ${err instanceof Error ? err.message : err}`)
  }
  const out = def.OutputSchema.parse(parsed) as O
  ctx.trace.event({ agent: childAgentName, event: 'return', ok: true })
  return out
}
