import { describe, it, expect } from 'vitest'
import type { SessionState } from '@travel-agent/shared'
import { ToolPool, type Tool } from './tool-pool.js'

const dummy = (name: string): Tool => ({
  name,
  description: `dummy ${name}`,
  parametersSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  isConcurrencySafe: () => true,
  call: async () => ({ type: 'ok', output: 'ok' }),
})

describe('ToolPool', () => {
  it('finds tools by name', () => {
    const p = new ToolPool([dummy('a'), dummy('b')])
    expect(p.find('a')?.name).toBe('a')
    expect(p.find('missing')).toBeUndefined()
  })

  it('emits OpenAI tool definitions', () => {
    const p = new ToolPool([dummy('a')])
    const ot = p.toOpenAITools()
    expect(ot).toHaveLength(1)
    expect(ot[0]!.type).toBe('function')
    expect(ot[0]!.function.name).toBe('a')
  })

  it('isolate() detects pool overlap', () => {
    const shared = dummy('overlap')
    const p1 = new ToolPool([shared, dummy('a')])
    const p2 = new ToolPool([shared, dummy('b')])
    expect(() => p1.assertDisjoint(p2)).toThrow(/overlap/)
  })

  it('isolate() passes for disjoint pools', () => {
    const p1 = new ToolPool([dummy('a')])
    const p2 = new ToolPool([dummy('b')])
    expect(() => p1.assertDisjoint(p2)).not.toThrow()
  })
})
