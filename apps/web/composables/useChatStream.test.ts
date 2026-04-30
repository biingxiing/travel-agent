import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./useApiBase', () => ({
  useApiBase: () => ({
    resolveApiBase: () => '',
  }),
}))

import { useChatStream } from './useChatStream'

describe('useChatStream', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    global.fetch = originalFetch
  })

  it('surfaces a clear error when the SSE stream goes idle', async () => {
    const stalledReader = {
      read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {})),
    }
    global.fetch = vi.fn(async () => ({
      ok: true,
      body: {
        getReader: () => stalledReader,
      },
    })) as typeof fetch

    const onError = vi.fn()
    const stream = useChatStream('session-1')

    const sendPromise = stream.sendMessage('hi', {
      onEvent: vi.fn(),
      onError,
    })

    await vi.advanceTimersByTimeAsync(240_000)
    await sendPromise

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe('规划生成超时，请重试。')
  })

  it('exposes createSession as a public method that sets the internal sessionId', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ session: { id: 'new-uuid-123' } }),
      body: null,
    })) as typeof fetch

    const stream = useChatStream(null)
    const id = await stream.createSession()

    expect(id).toBe('new-uuid-123')
    expect(stream.getSessionId()).toBe('new-uuid-123')
  })
})
