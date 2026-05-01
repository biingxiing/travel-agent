import type OpenAI from 'openai'
import type { SessionState, ChatStreamEvent } from '@travel-agent/shared'

export type EmitFn = (event: ChatStreamEvent) => Promise<void>

export type ToolResult =
  | { type: 'ok'; output: string }
  | { type: 'halt'; reason: string }

export interface Tool {
  name: string
  description: string
  parametersSchema: Record<string, unknown>
  isConcurrencySafe: () => boolean
  call: (
    input: Record<string, unknown>,
    session: SessionState,
    emit: EmitFn,
  ) => Promise<ToolResult>
}

export class ToolPool {
  constructor(public readonly tools: readonly Tool[]) {}

  find(name: string): Tool | undefined {
    return this.tools.find((t) => t.name === name)
  }

  toOpenAITools(): OpenAI.Chat.ChatCompletionTool[] {
    return this.tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parametersSchema,
      },
    }))
  }

  /** Throws if any tool name appears in both pools. Used in tests to guard isolation invariant. */
  assertDisjoint(other: ToolPool): void {
    const overlap = this.tools
      .map((t) => t.name)
      .filter((n) => other.tools.some((o) => o.name === n))
    if (overlap.length > 0) {
      throw new Error(`ToolPool overlap detected: ${overlap.join(', ')}`)
    }
  }
}
