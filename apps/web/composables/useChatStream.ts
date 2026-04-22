import type { StreamEvent } from "~/types/itinerary"
import { useApiBase } from "~/composables/useApiBase"
import { useAuthStore } from "~/stores/auth"

interface ParsedChunk {
  event?: string
  data?: string
}

function parseChunk(chunk: string): ParsedChunk {
  const parsed: ParsedChunk = {}

  for (const line of chunk.split("\n")) {
    if (line.startsWith("event:")) {
      parsed.event = line.slice(6).trim()
    }

    if (line.startsWith("data:")) {
      parsed.data = parsed.data ? `${parsed.data}\n${line.slice(5).trim()}` : line.slice(5).trim()
    }
  }

  return parsed
}

function normalizeEvent(chunk: string): StreamEvent | null {
  const parsed = parseChunk(chunk)

  if (!parsed.data) {
    return null
  }

  try {
    const payload = JSON.parse(parsed.data) as Record<string, unknown>
    const type = typeof payload.type === "string" ? payload.type : parsed.event

    if (!type) {
      return null
    }

    return {
      ...payload,
      type
    } as StreamEvent
  } catch {
    return {
      type: "error",
      message: "无法解析服务端返回的流式事件。"
    }
  }
}

const AUTH_REQUIRED_ERROR = "__AUTH_REQUIRED__"

export function isAuthRequiredError(error: unknown) {
  return error instanceof Error && error.message === AUTH_REQUIRED_ERROR
}

export function useChatStream() {
  const { resolveApiBase } = useApiBase()
  const authStore = useAuthStore()

  function createAuthRequiredError() {
    return new Error(AUTH_REQUIRED_ERROR)
  }

  async function createSession() {
    try {
      const apiBase = resolveApiBase()
      const url = `${apiBase}/api/sessions`
      const response = await fetch(url, {
        method: "POST",
        credentials: "include"
      })

      if (response.status === 401) {
        authStore.handleUnauthorized()
        throw createAuthRequiredError()
      }

      if (!response.ok) {
        console.error("createSession failed", {
          status: response.status,
          statusText: response.statusText,
          url
        })
        throw new Error("服务没连上，请确认前端 :3000 和后端 :3001 都已启动。")
      }

      const payload = (await response.json()) as { sessionId: string }
      return payload.sessionId
    } catch (error) {
      if (isAuthRequiredError(error)) {
        throw error
      }

      console.error("createSession request error", error)
      throw new Error("服务没连上，请确认前端 :3000 和后端 :3001 都已启动。")
    }
  }

  async function streamChat(sessionId: string, message: string, onEvent: (event: StreamEvent) => void) {
    const apiBase = resolveApiBase()
    const url = `${apiBase}/api/chat`
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream"
      },
      body: JSON.stringify({
        sessionId,
        message
      })
    })

    if (response.status === 401) {
      authStore.handleUnauthorized()
      throw createAuthRequiredError()
    }

    if (!response.ok || !response.body) {
      console.error("streamChat failed", {
        status: response.status,
        statusText: response.statusText,
        url
      })
      throw new Error("规划有点慢，要不要再试一次？")
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const chunks = buffer.split("\n\n")
      buffer = chunks.pop() ?? ""

      for (const chunk of chunks) {
        const event = normalizeEvent(chunk)

        if (event) {
          onEvent(event)
        }
      }
    }

    if (buffer.trim()) {
      const event = normalizeEvent(buffer.trim())

      if (event) {
        onEvent(event)
      }
    }
  }

  return {
    createSession,
    streamChat
  }
}
