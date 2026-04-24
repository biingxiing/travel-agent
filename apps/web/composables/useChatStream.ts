import { useApiBase } from './useApiBase'
import type { ChatStreamEvent, SessionState } from '@travel-agent/shared'

export interface ChatStreamHandlers {
  onEvent: (event: ChatStreamEvent) => void
  onClose?: () => void
  onError?: (err: unknown) => void
}

export interface ChatStreamSession {
  ensureSessionId: () => Promise<string>
  sendMessage: (content: string, handlers: ChatStreamHandlers) => Promise<void>
  continueOptimization: (handlers: ChatStreamHandlers) => Promise<void>
  setSessionId: (id: string | null) => void
  getSessionId: () => string | null
  loadSession: (id: string) => Promise<{ session: SessionState }>
}

export function useChatStream(initialSessionId: string | null = null): ChatStreamSession {
  const { resolveApiBase } = useApiBase()
  let sessionId: string | null = initialSessionId

  async function createSession(): Promise<string> {
    const apiBase = resolveApiBase()
    const r = await fetch(`${apiBase}/api/sessions`, {
      method: 'POST', credentials: 'include',
    })
    if (!r.ok) throw new Error(`Create session failed: ${r.status}`)
    const body = await r.json() as { session: { id: string } }
    sessionId = body.session.id
    return sessionId
  }

  async function ensureSessionId(): Promise<string> {
    return sessionId ?? await createSession()
  }

  async function streamRequest(url: string, init: RequestInit, handlers: ChatStreamHandlers) {
    let resp: Response
    try {
      resp = await fetch(url, { ...init, credentials: 'include' })
    } catch (err) { handlers.onError?.(err); return }
    if (!resp.ok || !resp.body) {
      handlers.onError?.(new Error(`HTTP ${resp.status}`))
      return
    }
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          const dataLine = block.split('\n').find((l) => l.startsWith('data:'))
          if (!dataLine) continue
          const json = dataLine.slice(5).trim()
          try {
            handlers.onEvent(JSON.parse(json) as ChatStreamEvent)
          } catch (err) { console.warn('[chatStream] parse failed', err) }
        }
      }
      handlers.onClose?.()
    } catch (err) { handlers.onError?.(err) }
  }

  async function sendMessage(content: string, handlers: ChatStreamHandlers) {
    const id = await ensureSessionId()
    const apiBase = resolveApiBase()
    await streamRequest(`${apiBase}/api/sessions/${id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }, handlers)
  }

  async function continueOptimization(handlers: ChatStreamHandlers) {
    const id = await ensureSessionId()
    const apiBase = resolveApiBase()
    await streamRequest(`${apiBase}/api/sessions/${id}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, handlers)
  }

  async function loadSession(id: string): Promise<{ session: SessionState }> {
    const r = await fetch(`${resolveApiBase()}/api/sessions/${id}`, { credentials: 'include' })
    if (!r.ok) throw new Error(`Load session failed: ${r.status}`)
    const body = await r.json() as { session: SessionState }
    sessionId = body.session.id
    return body
  }

  return {
    ensureSessionId, sendMessage, continueOptimization, loadSession,
    setSessionId: (id) => { sessionId = id },
    getSessionId: () => sessionId,
  }
}
