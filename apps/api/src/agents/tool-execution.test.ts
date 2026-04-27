// apps/api/src/agents/tool-execution.test.ts
import { describe, it, expect, vi } from 'vitest'
import { partitionToolCalls, executeSubagents } from './tool-execution.js'
import type { SubagentTool } from './tools/types.js'

const readTool = (name: string): SubagentTool => ({
  name,
  description: '',
  parametersSchema: {},
  isConcurrencySafe: () => true,
  call: vi.fn().mockResolvedValue({ type: 'ok', output: `result:${name}` }),
})
const writeTool = (name: string): SubagentTool => ({
  name,
  description: '',
  parametersSchema: {},
  isConcurrencySafe: () => false,
  call: vi.fn().mockResolvedValue({ type: 'ok', output: `result:${name}` }),
})
const haltTool = (name: string): SubagentTool => ({
  name,
  description: '',
  parametersSchema: {},
  isConcurrencySafe: () => false,
  call: vi.fn().mockResolvedValue({ type: 'halt', reason: 'clarification_requested' }),
})

describe('partitionToolCalls', () => {
  it('groups consecutive read-only calls into a single concurrent batch', () => {
    const tools = [readTool('a'), readTool('b'), writeTool('c')]
    const blocks = [
      { id: '1', name: 'a', input: {} },
      { id: '2', name: 'b', input: {} },
      { id: '3', name: 'c', input: {} },
    ]
    const batches = partitionToolCalls(blocks, tools)
    expect(batches).toHaveLength(2)
    expect(batches[0]).toEqual({ concurrent: true, blocks: [blocks[0], blocks[1]] })
    expect(batches[1]).toEqual({ concurrent: false, blocks: [blocks[2]] })
  })

  it('flushes concurrent batch before a write tool', () => {
    const tools = [readTool('a'), writeTool('b'), readTool('c')]
    const blocks = [
      { id: '1', name: 'a', input: {} },
      { id: '2', name: 'b', input: {} },
      { id: '3', name: 'c', input: {} },
    ]
    const batches = partitionToolCalls(blocks, tools)
    expect(batches).toHaveLength(3)
    expect(batches[0].concurrent).toBe(true)
    expect(batches[1].concurrent).toBe(false)
    expect(batches[2].concurrent).toBe(true)
  })

  it('puts a solo write tool in its own batch', () => {
    const tools = [writeTool('w')]
    const blocks = [{ id: '1', name: 'w', input: {} }]
    const batches = partitionToolCalls(blocks, tools)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toEqual({ concurrent: false, blocks })
  })

  it('groups all read-only calls into one batch', () => {
    const tools = [readTool('a'), readTool('b')]
    const blocks = [{ id: '1', name: 'a', input: {} }, { id: '2', name: 'b', input: {} }]
    const batches = partitionToolCalls(blocks, tools)
    expect(batches).toHaveLength(1)
    expect(batches[0].concurrent).toBe(true)
  })
})

describe('executeSubagents', () => {
  const fakeSession = {} as any
  const fakeEmit = vi.fn()

  it('returns tool results for each block', async () => {
    const tools = [readTool('a'), readTool('b')]
    const blocks = [{ id: '1', name: 'a', input: {} }, { id: '2', name: 'b', input: {} }]
    const { toolResults, shouldHalt } = await executeSubagents(blocks, tools, fakeSession, fakeEmit)
    expect(toolResults).toHaveLength(2)
    expect(toolResults[0]).toEqual({ role: 'tool', tool_call_id: '1', content: 'result:a' })
    expect(toolResults[1]).toEqual({ role: 'tool', tool_call_id: '2', content: 'result:b' })
    expect(shouldHalt).toBe(false)
  })

  it('sets shouldHalt when a halt tool is called', async () => {
    const tools = [haltTool('h')]
    const blocks = [{ id: '1', name: 'h', input: {} }]
    const { shouldHalt } = await executeSubagents(blocks, tools, fakeSession, fakeEmit)
    expect(shouldHalt).toBe(true)
  })

  it('returns error output for unknown tool name', async () => {
    const tools = [readTool('known')]
    const blocks = [{ id: '1', name: 'unknown', input: {} }]
    const { toolResults } = await executeSubagents(blocks, tools, fakeSession, fakeEmit)
    expect(toolResults[0].content).toContain('unknown tool')
  })
})
