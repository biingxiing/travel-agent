// apps/api/src/agents/react-loop.ts
import { randomUUID } from 'crypto'
import type OpenAI from 'openai'
import { PLANNER_MODEL } from '../llm/client.js'
import { loggedStream } from '../llm/logger.js'
import type { SessionState, ChatStreamEvent } from '@travel-agent/shared'
import { ALL_TOOLS, toOpenAITools, buildOrchestratorMessages, buildStateContextMessage } from './tools/index.js'
import type { EmitFn, LoopState } from './tools/types.js'
import { executeSubagents } from './tool-execution.js'
import type { ToolCallBlock } from './tool-execution.js'

const MAX_TURNS = 10

async function streamOrchestrator(
  state: LoopState,
  session: SessionState,
  emit: EmitFn,
): Promise<{
  assistantMessage: OpenAI.Chat.ChatCompletionMessageParam
  toolCalls: ToolCallBlock[]
  fullContent: string
}> {
  let fullContent = ''
  const rawToolCalls = new Map<number, { id: string; name: string; arguments: string }>()
  const openAITools = toOpenAITools(state.tools)

  // Refresh the trailing state-context message so the orchestrator sees current
  // session values (brief, prefetchContextSize, etc.) set by prior tool calls.
  const msgs = state.messages
  const freshCtx = buildStateContextMessage(session)
  const last = msgs[msgs.length - 1]
  const messages = (last?.role === 'user' && typeof last.content === 'string' && last.content.startsWith('Session state:'))
    ? [...msgs.slice(0, -1), freshCtx]
    : [...msgs, freshCtx]

  for await (const chunk of loggedStream('orchestrator', {
    model: PLANNER_MODEL,
    messages,
    tools: openAITools,
    tool_choice: 'auto',
    temperature: 0.3,
  })) {
    const delta = chunk.choices[0]?.delta
    if (!delta) continue

    if (delta.content) {
      fullContent += delta.content
      // Per-chunk live preview (kept for future foldable "thinking" UI).
      // Final user-visible emission happens after the stream ends, based on
      // whether tool calls follow.
      await emit({ type: 'tool_reasoning', delta: delta.content } as ChatStreamEvent)
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0
        const existing = rawToolCalls.get(idx) ?? { id: '', name: '', arguments: '' }
        rawToolCalls.set(idx, {
          id: tc.id ? tc.id : existing.id,
          name: tc.function?.name ? tc.function.name : existing.name,
          arguments: existing.arguments + (tc.function?.arguments ?? ''),
        })
      }
    }
  }

  const toolCallsList = Array.from(rawToolCalls.entries())
    .sort(([a], [b]) => a - b)
    .map(([, tc]) => tc)

  const toolCalls: ToolCallBlock[] = toolCallsList.map(tc => {
    let input: Record<string, unknown> = {}
    let parseError: string | undefined
    try {
      input = tc.arguments ? JSON.parse(tc.arguments) : {}
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err)
    }
    return parseError
      ? { id: tc.id, name: tc.name, input, parseError }
      : { id: tc.id, name: tc.name, input }
  })

  const assistantMessage: OpenAI.Chat.ChatCompletionMessageParam = toolCalls.length > 0
    ? {
      role: 'assistant',
      content: fullContent || null,
      tool_calls: toolCallsList.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    }
    : { role: 'assistant', content: fullContent }

  return { assistantMessage, toolCalls, fullContent }
}

function isCancelled(session: SessionState, runId: string): boolean {
  return session.lastRunId !== runId
}

export async function* runReactLoop(
  session: SessionState,
  runId: string,
  emit: EmitFn,
): AsyncGenerator<ChatStreamEvent, void, void> {
  let state: LoopState = {
    messages: buildOrchestratorMessages(session),
    tools: ALL_TOOLS,
    turnCount: 0,
    runId,
  }

  while (state.turnCount < MAX_TURNS) {
    if (isCancelled(session, runId)) {
      yield { type: 'done', messageId: randomUUID() }
      return
    }

    const { assistantMessage, toolCalls, fullContent } = await streamOrchestrator(state, session, emit)
    const trimmed = fullContent.trim()

    // No tool calls → orchestrator responded with plain text (no further tool
    // calls). Treat as genuine convergence only when the session score actually
    // meets the threshold — this guards against the LLM erroneously producing
    // a narrative response instead of calling call_refiner when converged=false.
    if (toolCalls.length === 0) {
      const score = session.currentScore
      const evaluation = session.currentEvaluation
      // If we have an evaluation that explicitly says not converged, the LLM
      // has violated the post-evaluator rule by emitting prose instead of
      // calling call_refiner. Treat this as a max-iter exit rather than
      // convergence so the frontend shows "Continue Optimization" instead of
      // locking the session.
      const evaluationSaysNotConverged = evaluation != null && !evaluation.converged
      if (evaluationSaysNotConverged) {
        // Emit the text as a narrative bubble so the user can see it, but do
        // not mark the session as converged.
        if (trimmed) {
          await emit({ type: 'assistant_say', content: fullContent })
        }
        session.status = 'awaiting_user'
        if (session.currentPlan && score) {
          yield {
            type: 'max_iter_reached',
            currentScore: score.overall,
            plan: session.currentPlan,
          }
        }
        yield { type: 'done', messageId: randomUUID() }
        return
      }
      if (trimmed) {
        await emit({ type: 'token', delta: fullContent })
      }
      session.status = 'converged'
      session.pendingClarification = null
      yield { type: 'done', messageId: randomUUID(), converged: true }
      return
    }

    // Tool calls present → any narrative text is internal orchestrator reasoning
    // that has leaked alongside the tool invocation. Do NOT surface it to the
    // user as an assistant_say bubble — it often contains confusing fragments
    // like "下面是可直接使用的完整 JSON：" that make no sense in the chat panel.
    // assistant_say is only emitted when the LLM produces text with NO tool calls
    // (see the toolCalls.length === 0 branches above).

    if (isCancelled(session, runId)) {
      yield { type: 'done', messageId: randomUUID() }
      return
    }

    const { toolResults, shouldHalt } = await executeSubagents(
      toolCalls, state.tools, session, emit,
    )

    if (shouldHalt) {
      yield { type: 'done', messageId: randomUUID() }
      return
    }

    const toolResultMessages: OpenAI.Chat.ChatCompletionMessageParam[] = toolResults.map(r => ({
      role: 'tool' as const,
      tool_call_id: r.tool_call_id,
      content: r.content,
    }))

    state = {
      ...state,
      messages: [...state.messages, assistantMessage, ...toolResultMessages],
      turnCount: state.turnCount + 1,
    }
  }

  // Reached MAX_TURNS without convergence
  session.status = 'awaiting_user'
  if (session.currentPlan && session.currentScore) {
    yield {
      type: 'max_iter_reached',
      currentScore: session.currentScore.overall,
      plan: session.currentPlan,
    }
  }
  yield { type: 'done', messageId: randomUUID() }
}
