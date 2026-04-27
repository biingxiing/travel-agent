// apps/api/src/agents/tools/types.ts
import type OpenAI from 'openai'
import type { SessionState, ChatStreamEvent } from '@travel-agent/shared'

export type EmitFn = (event: ChatStreamEvent) => Promise<void>

export interface SubagentTool {
  name: string
  description: string
  /** Plain JSON Schema object for the OpenAI tool call */
  parametersSchema: Record<string, unknown>
  isConcurrencySafe(): boolean
  call(
    input: Record<string, unknown>,
    session: SessionState,
    emit: EmitFn,
  ): Promise<SubagentResult>
}

export type SubagentResult =
  | { type: 'ok'; output: string }
  | { type: 'halt'; reason: 'clarification_requested' }

export interface LoopState {
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
  tools: SubagentTool[]
  turnCount: number
  runId: string
}

export interface ExecuteResult {
  toolResults: Array<{ role: 'tool'; tool_call_id: string; content: string }>
  shouldHalt: boolean
}
