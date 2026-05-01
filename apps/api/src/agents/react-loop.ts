import { randomUUID } from 'crypto'
import type OpenAI from 'openai'
import type { SessionState, ChatStreamEvent } from '@travel-agent/shared'
import { QueryEngine } from './runtime/query-engine.js'
import { Trace } from './runtime/trace.js'
import {
  TOOLS as ORCHESTRATOR_POOL,
  buildMessages as buildOrchestratorMessages,
  buildStateContextMessage,
} from './personas/orchestrator.js'
import './personas/researcher.js'                              // side-effect: registers persona

const MAX_TURNS = 10
type EmitFn = (event: ChatStreamEvent) => Promise<void>

function makeChildCounter(): { next(): number } {
  let i = 0
  return { next() { return i++ } }
}

export async function* runReactLoop(
  session: SessionState,
  runId: string,
  emit: EmitFn,
): AsyncGenerator<ChatStreamEvent, void, void> {
  const trace = new Trace(runId)
  ;(session as { __runtime__?: unknown }).__runtime__ = {
    trace, runId, childCounter: makeChildCounter(),
  }

  // Stable prefix is computed once: system prompt + optional summary + recent 20 turns.
  // State-context is appended FRESH before each engine.run() so the orchestrator sees
  // the latest brief/plan/research counts, while the prefix stays cache-friendly.
  const prefix = await buildOrchestratorMessages(session)
  let accumulated: OpenAI.Chat.ChatCompletionMessageParam[] = []

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (session.lastRunId !== runId) {
      yield { type: 'done', messageId: randomUUID() }
      await trace.close()
      return
    }

    const messages = [...prefix, ...accumulated, buildStateContextMessage(session)]

    const engine = new QueryEngine({
      persona: 'orchestrator',
      pool: ORCHESTRATOR_POOL,
      session, runId, messages, trace,
    })
    const r = await engine.run()
    if (r.cancelled) {
      yield { type: 'done', messageId: randomUUID() }
      await trace.close()
      return
    }

    if (r.toolCalls.length === 0) {
      const trimmed = r.fullContent.trim()
      if (trimmed) yield { type: 'token', delta: r.fullContent }
      session.status = 'converged'
      session.pendingClarification = null
      yield { type: 'done', messageId: randomUUID(), converged: true }
      await trace.close()
      return
    }

    const { toolResultMessages, halt } = await engine.dispatchToolCalls(r.toolCalls, emit)
    if (halt) {
      yield { type: 'done', messageId: randomUUID() }
      await trace.close()
      return
    }

    accumulated = [...accumulated, r.assistantMessage, ...toolResultMessages]
  }

  session.status = 'converged'
  yield { type: 'done', messageId: randomUUID(), converged: true }
  await trace.close()
}
