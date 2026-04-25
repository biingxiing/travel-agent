import { randomUUID } from 'crypto'
import { AsyncLocalStorage } from 'async_hooks'
import { llm } from './client.js'
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
  errorMsg?: string,
): void {
  const sess = ctx.sessionId ? ` session=${ctx.sessionId.slice(0, 8)}` : ''
  const run = ctx.runId ? ` run=${ctx.runId.slice(0, 8)}` : ''
  if (ok) {
    console.log(
      `[llm] agent=${agent} model=${model} ${latencyMs}ms in=${usage.prompt ?? '?'} out=${usage.completion ?? '?'} total=${usage.total ?? '?'}${sess}${run}`,
    )
  } else {
    console.log(`[llm] agent=${agent} model=${model} ${latencyMs}ms ERR msg="${errorMsg ?? 'unknown'}"${sess}${run}`)
  }
}

export async function loggedCompletion(
  agent: string,
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
): Promise<OpenAI.Chat.ChatCompletion> {
  const ctx = getCtx()
  const start = Date.now()
  try {
    const resp = await llm.chat.completions.create(params)
    const ms = Date.now() - start
    const u = resp.usage
    logLine(agent, params.model, ms, ctx, true, {
      prompt: u?.prompt_tokens, completion: u?.completion_tokens, total: u?.total_tokens,
    })
    void insertLLMCall({
      id: randomUUID(), sessionId: ctx.sessionId, runId: ctx.runId,
      agent, model: params.model, stream: false,
      request: truncateRequest(params),
      response: { content: resp.choices[0]?.message?.content ?? '', finish_reason: resp.choices[0]?.finish_reason ?? null },
      promptTokens: u?.prompt_tokens ?? null, completionTokens: u?.completion_tokens ?? null, totalTokens: u?.total_tokens ?? null,
      latencyMs: ms, ok: true, errorMessage: null, errorCode: null,
    }).catch((e) => console.warn('[llm-logger] DB write failed:', e instanceof Error ? e.message : e))
    return resp
  } catch (err) {
    const ms = Date.now() - start
    const msg = err instanceof Error ? err.message : String(err)
    const code = (err as Record<string, unknown>)?.code as string | null ?? null
    logLine(agent, params.model, ms, ctx, false, {}, msg)
    void insertLLMCall({
      id: randomUUID(), sessionId: ctx.sessionId, runId: ctx.runId,
      agent, model: params.model, stream: false,
      request: truncateRequest(params), response: null,
      promptTokens: null, completionTokens: null, totalTokens: null,
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
  try {
    const stream = await llm.chat.completions.create({ ...paramsWithUsage, stream: true })
    for await (const chunk of stream) {
      content += chunk.choices[0]?.delta?.content ?? ''
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens ?? null
        completionTokens = chunk.usage.completion_tokens ?? null
        totalTokens = chunk.usage.total_tokens ?? null
      }
      yield chunk
    }
  } catch (err) {
    ok = false
    errorMsg = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    const ms = Date.now() - start
    logLine(agent, params.model, ms, ctx, ok, { prompt: promptTokens, completion: completionTokens, total: totalTokens }, errorMsg ?? undefined)
    void insertLLMCall({
      id: randomUUID(), sessionId: ctx.sessionId, runId: ctx.runId,
      agent, model: params.model, stream: true,
      request: truncateRequest(paramsWithUsage),
      response: ok ? { content, finish_reason: 'stop' } : null,
      promptTokens, completionTokens, totalTokens,
      latencyMs: ms, ok, errorMessage: errorMsg, errorCode: null,
    }).catch((e) => console.warn('[llm-logger] DB write failed:', e instanceof Error ? e.message : e))
  }
}
