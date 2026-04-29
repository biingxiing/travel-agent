// apps/api/src/agents/tool-execution.ts
import type { SubagentTool, EmitFn, ExecuteResult } from './tools/types.js'
import type { SessionState } from '@travel-agent/shared'

export interface ToolCallBlock {
  id: string
  name: string
  input: Record<string, unknown>
  /** Set when the LLM emitted malformed JSON for tool arguments — surfaced back to the LLM via tool_result. */
  parseError?: string
}

interface Batch {
  concurrent: boolean
  blocks: ToolCallBlock[]
}

export function partitionToolCalls(blocks: ToolCallBlock[], tools: SubagentTool[]): Batch[] {
  const batches: Batch[] = []
  let concurrentBatch: ToolCallBlock[] = []

  for (const block of blocks) {
    const tool = tools.find(t => t.name === block.name)
    if (tool?.isConcurrencySafe()) {
      concurrentBatch.push(block)
    } else {
      if (concurrentBatch.length > 0) {
        batches.push({ concurrent: true, blocks: concurrentBatch })
        concurrentBatch = []
      }
      batches.push({ concurrent: false, blocks: [block] })
    }
  }
  if (concurrentBatch.length > 0) {
    batches.push({ concurrent: true, blocks: concurrentBatch })
  }
  return batches
}

async function runOne(
  block: ToolCallBlock,
  tools: SubagentTool[],
  session: SessionState,
  emit: EmitFn,
): Promise<{ id: string; output: string; shouldHalt: boolean }> {
  if (block.parseError) {
    return {
      id: block.id,
      output: `Error: invalid JSON arguments — ${block.parseError}. Please retry the call with valid JSON matching the tool's parametersSchema.`,
      shouldHalt: false,
    }
  }
  const tool = tools.find(t => t.name === block.name)
  if (!tool) {
    return { id: block.id, output: `Error: unknown tool "${block.name}"`, shouldHalt: false }
  }
  try {
    const result = await tool.call(block.input, session, emit)
    if (result.type === 'halt') {
      return { id: block.id, output: 'Clarification requested from user.', shouldHalt: true }
    }
    return { id: block.id, output: result.output, shouldHalt: false }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { id: block.id, output: `Tool error: ${msg}`, shouldHalt: false }
  }
}

export async function executeSubagents(
  blocks: ToolCallBlock[],
  tools: SubagentTool[],
  session: SessionState,
  emit: EmitFn,
): Promise<ExecuteResult> {
  const toolResults: ExecuteResult['toolResults'] = []
  let shouldHalt = false

  for (const batch of partitionToolCalls(blocks, tools)) {
    let results: Array<{ id: string; output: string; shouldHalt: boolean }>
    if (batch.concurrent) {
      results = await Promise.all(batch.blocks.map(b => runOne(b, tools, session, emit)))
    } else {
      results = []
      for (const block of batch.blocks) {
        results.push(await runOne(block, tools, session, emit))
      }
    }
    for (const r of results) {
      toolResults.push({ role: 'tool', tool_call_id: r.id, content: r.output })
      if (r.shouldHalt) shouldHalt = true
    }
  }

  return { toolResults, shouldHalt }
}
