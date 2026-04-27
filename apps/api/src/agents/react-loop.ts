// apps/api/src/agents/react-loop.ts
import { randomUUID } from 'crypto'
import type OpenAI from 'openai'
import { PLANNER_MODEL } from '../llm/client.js'
import { loggedStream } from '../llm/logger.js'
import type { SessionState, ChatStreamEvent } from '@travel-agent/shared'
import { ALL_TOOLS, toOpenAITools, buildOrchestratorMessages } from './tools/index.js'
import type { EmitFn, LoopState } from './tools/types.js'
import { executeSubagents } from './tool-execution.js'
import type { ToolCallBlock } from './tool-execution.js'

const MAX_TURNS = 10

async function streamOrchestrator(
  state: LoopState,
  emit: EmitFn,
): Promise<{
  assistantMessage: OpenAI.Chat.ChatCompletionMessageParam
  toolCalls: ToolCallBlock[]
}> {
  let fullContent = ''
  const rawToolCalls = new Map<number, { id: string; name: string; arguments: string }>()
  const openAITools = toOpenAITools(state.tools)

  for await (const chunk of loggedStream('orchestrator', {
    model: PLANNER_MODEL,
    messages: state.messages,
    tools: openAITools,
    tool_choice: 'auto',
    temperature: 0.3,
  })) {
    const delta = chunk.choices[0]?.delta
    if (!delta) continue

    if (delta.content) {
      fullContent += delta.content
      await emit({ type: 'tool_reasoning', delta: delta.content } as any)
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
    try { input = JSON.parse(tc.arguments || '{}') } catch { /* malformed JSON */ }
    return { id: tc.id, name: tc.name, input }
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

  return { assistantMessage, toolCalls }
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
    if (isCancelled(session, runId)) return

    const { assistantMessage, toolCalls } = await streamOrchestrator(state, emit)

    // No tool calls → orchestrator decided it's done
    if (toolCalls.length === 0) {
      session.status = 'converged'
      session.pendingClarification = null
      yield { type: 'done', messageId: randomUUID(), converged: true }
      return
    }

    if (isCancelled(session, runId)) return

    const { toolResults, shouldHalt } = await executeSubagents(
      toolCalls, state.tools, session, emit,
    )

    if (shouldHalt) return

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
}
