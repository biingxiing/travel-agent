import { randomUUID } from 'crypto'
import { AsyncLocalStorage } from 'async_hooks'
import { llm, REASONING_EFFORT } from './client.js'
import { insertLLMCall } from '../persistence/pg.js'
import type OpenAI from 'openai'

interface SessionCtx {
  sessionId: string | null
  runId: string | null
}

const storage = new AsyncLocalStorage<SessionCtx>()

export function withSessionContext<T>(
  sessionId: string,
  runId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run({ sessionId, runId }, fn)
}

function getCtx(): SessionCtx {
  return storage.getStore() ?? { sessionId: null, runId: null }
}

const VERBOSE = process.env.LLM_VERBOSE === 'true'

const MAX_REQUEST_BYTES = 256 * 1024

function truncateRequest(req: unknown): unknown {
  const s = JSON.stringify(req)
  if (s.length <= MAX_REQUEST_BYTES) return req
  const r = req as Record<string, unknown>
  if (!Array.isArray(r?.messages)) return req
  return {
    ...r,
    messages: (r.messages as Array<{ content?: unknown }>).map((m) => {
      if (typeof m?.content !== 'string' || m.content.length <= 2000) return m
      return { ...m, content: m.content.slice(0, 2000) + `…[truncated ${m.content.length - 2000} chars]` }
    }),
  }
}

function logLine(
  agent: string,
  model: string,
  latencyMs: number,
  ctx: SessionCtx,
  ok: boolean,
  usage: { prompt?: number | null; completion?: number | null; total?: number | null },
  cached: number | null,
  effort: string | undefined,
  errorMsg?: string,
): void {
  const sess = ctx.sessionId ? ` session=${ctx.sessionId.slice(0, 8)}` : ''
  const run = ctx.runId ? ` run=${ctx.runId.slice(0, 8)}` : ''
  const eff = effort ? ` effort=${effort}` : ''
  const cach = cached && cached > 0 ? ` cached=${cached}` : ''
  if (ok) {
    console.log(
      `[llm] agent=${agent} model=${model}${eff}${cach} ${latencyMs}ms in=${usage.prompt ?? '?'} out=${usage.completion ?? '?'} total=${usage.total ?? '?'}${sess}${run}`,
    )
  } else {
    console.log(`[llm] agent=${agent} model=${model}${eff}${cach} ${latencyMs}ms ERR msg="${errorMsg ?? 'unknown'}"${sess}${run}`)
  }
}

function resolveEffort(params: Record<string, unknown>): string | undefined {
  const callerEffort = typeof params.reasoning_effort === 'string' ? params.reasoning_effort : undefined
  return callerEffort ?? REASONING_EFFORT
}

export async function loggedCompletion(
  agent: string,
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
): Promise<OpenAI.Chat.ChatCompletion> {
  const ctx = getCtx()
  const start = Date.now()
  let content = ''
  let finishReason: string | null = null
  let promptTokens: number | null = null
  let completionTokens: number | null = null
  let totalTokens: number | null = null
  let cachedTokens: number | null = null
  try {
    const stream = await llm.chat.completions.create({
      ...(REASONING_EFFORT ? { reasoning_effort: REASONING_EFFORT as 'low' | 'medium' | 'high' } : {}),
      ...params,
      stream: true,
      stream_options: { include_usage: true },
    })
    for await (const chunk of stream) {
      content += chunk.choices[0]?.delta?.content ?? ''
      finishReason = chunk.choices[0]?.finish_reason ?? finishReason
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens ?? null
        completionTokens = chunk.usage.completion_tokens ?? null
        totalTokens = chunk.usage.total_tokens ?? null
        const details = (chunk.usage as unknown as Record<string, unknown>).prompt_tokens_details
        if (details && typeof details === 'object') {
          const c = (details as Record<string, unknown>).cached_tokens
          if (typeof c === 'number' && c > 0) cachedTokens = c
        }
      }
    }
    const ms = Date.now() - start
    logLine(agent, params.model, ms, ctx, true, { prompt: promptTokens, completion: completionTokens, total: totalTokens }, cachedTokens, resolveEffort(params as unknown as Record<string, unknown>))
    if (VERBOSE) {
      console.log(`[llm:input] agent=${agent}\n${JSON.stringify(params.messages, null, 2)}`)
      console.log(`[llm:output] agent=${agent}\n${content}`)
    }
    void insertLLMCall({
      id: randomUUID(), sessionId: ctx.sessionId, runId: ctx.runId,
      agent, model: params.model, stream: true,
      request: truncateRequest(params),
      response: { content, finish_reason: finishReason ?? 'stop' },
      promptTokens, completionTokens, totalTokens, cachedTokens,
      latencyMs: ms, ok: true, errorMessage: null, errorCode: null,
    }).catch((e) => console.warn('[llm-logger] DB write failed:', e instanceof Error ? e.message : e))
    return {
      id: '',
      object: 'chat.completion',
      created: Math.floor(start / 1000),
      model: params.model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: (finishReason ?? 'stop') as OpenAI.Chat.ChatCompletion.Choice['finish_reason'],
        logprobs: null,
      }],
      usage: promptTokens != null ? {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens ?? 0,
        total_tokens: totalTokens ?? 0,
      } : undefined,
    }
  } catch (err) {
    const ms = Date.now() - start
    const msg = err instanceof Error ? err.message : String(err)
    const code = (err as Record<string, unknown>)?.code as string | null ?? null
    logLine(agent, params.model, ms, ctx, false, {}, null, resolveEffort(params as unknown as Record<string, unknown>), msg)
    void insertLLMCall({
      id: randomUUID(), sessionId: ctx.sessionId, runId: ctx.runId,
      agent, model: params.model, stream: true,
      request: truncateRequest(params), response: null,
      promptTokens: null, completionTokens: null, totalTokens: null, cachedTokens: null,
      latencyMs: ms, ok: false, errorMessage: msg, errorCode: code,
    }).catch((e) => console.warn('[llm-logger] DB write failed:', e instanceof Error ? e.message : e))
    throw err
  }
}

export async function* loggedStream(
  agent: string,
  params: Omit<OpenAI.Chat.ChatCompletionCreateParamsStreaming, 'stream'>,
): AsyncGenerator<OpenAI.Chat.ChatCompletionChunk> {
  const ctx = getCtx()
  const start = Date.now()
  const existingStreamOptions = (params as Record<string, unknown>).stream_options
  const paramsWithUsage = {
    ...params,
    stream_options: {
      include_usage: true,
      ...(existingStreamOptions && typeof existingStreamOptions === 'object' ? existingStreamOptions as Record<string, unknown> : {}),
    },
  }
  let content = ''
  let ok = true
  let errorMsg: string | null = null
  let promptTokens: number | null = null
  let completionTokens: number | null = null
  let totalTokens: number | null = null
  let cachedTokens: number | null = null
  try {
    const stream = await llm.chat.completions.create({
      ...(REASONING_EFFORT ? { reasoning_effort: REASONING_EFFORT as 'low' | 'medium' | 'high' } : {}),
      ...paramsWithUsage,
      stream: true,
    })
    for await (const chunk of stream) {
      content += chunk.choices[0]?.delta?.content ?? ''
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens ?? null
        completionTokens = chunk.usage.completion_tokens ?? null
        totalTokens = chunk.usage.total_tokens ?? null
        const details = (chunk.usage as unknown as Record<string, unknown>).prompt_tokens_details
        if (details && typeof details === 'object') {
          const c = (details as Record<string, unknown>).cached_tokens
          if (typeof c === 'number' && c > 0) cachedTokens = c
        }
      }
      yield chunk
    }
  } catch (err) {
    ok = false
    errorMsg = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    const ms = Date.now() - start
    logLine(agent, params.model, ms, ctx, ok, { prompt: promptTokens, completion: completionTokens, total: totalTokens }, cachedTokens, resolveEffort(params as unknown as Record<string, unknown>), errorMsg ?? undefined)
    if (VERBOSE) {
      const rawTools = (params as unknown as Record<string, unknown>).tools
      const tools = Array.isArray(rawTools)
        ? (rawTools as Record<string, unknown>[]).map((t) => {
            const fn = t.function as Record<string, unknown> | undefined
            return fn?.name ?? t.name
          })
        : undefined
      console.log(`[llm:input] agent=${agent}${tools ? ` tools=[${tools.join(',')}]` : ''}\n${JSON.stringify(params.messages, null, 2)}`)
      if (ok) console.log(`[llm:output] agent=${agent}\n${content}`)
    }
    void insertLLMCall({
      id: randomUUID(), sessionId: ctx.sessionId, runId: ctx.runId,
      agent, model: params.model, stream: true,
      request: truncateRequest(paramsWithUsage),
      response: ok ? { content, finish_reason: 'stop' } : null,
      promptTokens, completionTokens, totalTokens, cachedTokens,
      latencyMs: ms, ok, errorMessage: errorMsg, errorCode: null,
    }).catch((e) => console.warn('[llm-logger] DB write failed:', e instanceof Error ? e.message : e))
  }
}
