import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { parseLLMJson } from './json-retry.js'

const Schema = z.object({ score: z.number() })

describe('parseLLMJson', () => {
  it('returns parsed object on clean JSON', async () => {
    const retry = vi.fn()
    const result = await parseLLMJson('{"score": 80}', Schema, retry)
    expect(result).toEqual({ score: 80 })
    expect(retry).not.toHaveBeenCalled()
  })

  it('extracts JSON from prose wrapping', async () => {
    const retry = vi.fn()
    const result = await parseLLMJson(
      'Sure, here you go: {"score": 75} hope this helps!',
      Schema,
      retry,
    )
    expect(result).toEqual({ score: 75 })
    expect(retry).not.toHaveBeenCalled()
  })

  it('extracts JSON from a fenced markdown block', async () => {
    const retry = vi.fn()
    const result = await parseLLMJson(
      '```json\n{"score": 90}\n```',
      Schema,
      retry,
    )
    expect(result).toEqual({ score: 90 })
    expect(retry).not.toHaveBeenCalled()
  })

  it('calls retry once when initial parse fails', async () => {
    const retry = vi.fn().mockResolvedValue('{"score": 60}')
    const result = await parseLLMJson('Sorry I cannot do that.', Schema, retry)
    expect(retry).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ score: 60 })
  })

  it('calls retry once when content fails schema validation', async () => {
    const retry = vi.fn().mockResolvedValue('{"score": 85}')
    const result = await parseLLMJson('{"score": "not a number"}', Schema, retry)
    expect(retry).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ score: 85 })
  })

  it('returns null when retry also fails', async () => {
    const retry = vi.fn().mockResolvedValue('still garbage')
    const result = await parseLLMJson('garbage', Schema, retry)
    expect(retry).toHaveBeenCalledTimes(1)
    expect(result).toBeNull()
  })

  it('returns null and does not retry when retry is not provided', async () => {
    const result = await parseLLMJson('garbage', Schema)
    expect(result).toBeNull()
  })
})
