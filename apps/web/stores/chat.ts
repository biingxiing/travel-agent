import { defineStore } from "pinia"
import type { ChatStreamEvent, Message, Plan } from "@travel-agent/shared"
import type { ChatMessage, Role } from "~/types/itinerary"
import { useWorkspaceStore } from "./workspace"

const welcomeMessage: ChatMessage = {
  id: "assistant-welcome",
  role: "assistant",
  content: "你好呀～告诉我你想去哪、几天、几个人，我来帮你安排行程～"
}

const planningMessages = {
  thinking: "正在理解你的需求…",
} as const

const CHAT_SESSION_STORAGE_KEY = "travel-agent-chat-state"

interface PersistedChatState {
  sessionId: string
  draft: string
  phase: "idle" | "planning" | "result" | "error"
  agentStatus: string
  streamSteps: string[]
  errorMessage: string
  messages: ChatMessage[]
  plan: Plan | null
}

function canUseSessionStorage() {
  return import.meta.client && typeof window !== "undefined" && typeof window.sessionStorage !== "undefined"
}

function persistChatState(state: PersistedChatState) {
  if (!canUseSessionStorage()) {
    return
  }

  window.sessionStorage.setItem(CHAT_SESSION_STORAGE_KEY, JSON.stringify(state))
}

function readPersistedChatState(): PersistedChatState | null {
  if (!canUseSessionStorage()) {
    return null
  }

  const raw = window.sessionStorage.getItem(CHAT_SESSION_STORAGE_KEY)

  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as PersistedChatState
  } catch {
    window.sessionStorage.removeItem(CHAT_SESSION_STORAGE_KEY)
    return null
  }
}

function clearPersistedChatState() {
  if (!canUseSessionStorage()) {
    return
  }

  window.sessionStorage.removeItem(CHAT_SESSION_STORAGE_KEY)
}

function normalizeMessages(messages: ChatMessage[] | undefined) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [welcomeMessage]
  }

  return messages.filter((message) => message && typeof message.id === "string" && typeof message.content === "string")
}

function sanitizeAssistantHistoryContent(content: string) {
  if (!content) return content

  if (content.includes("```json")) {
    const prose = content.slice(0, content.indexOf("```json")).trim()
    if (!prose || prose.endsWith("：") || prose.endsWith(":")) {
      return "✅ 行程已生成"
    }
    return prose
  }

  const hasMarkdown = content.includes("**") || content.includes("## ") || /^- /m.test(content)
  const isLongMultiline = content.length > 300 && content.includes("\n")

  if (hasMarkdown || isLongMultiline) {
    return "✅ 行程已生成"
  }

  return content
}

function sanitizeHistoryMessage(message: ChatMessage): ChatMessage {
  if (message.role !== "assistant") {
    return message
  }

  return {
    ...message,
    content: sanitizeAssistantHistoryContent(message.content),
  }
}

export function sanitizePersistedState(payload: PersistedChatState) {
  const plan = payload.plan ?? null
  const hasPlan = Boolean(plan)
  const messages = normalizeMessages(payload.messages)
    .map(sanitizeHistoryMessage)
    .filter((message) => !hasPlan || message.role !== "system")
    .filter((message) => message.content.trim().length > 0 || message.id === welcomeMessage.id)
  const nextPhase = hasPlan
    ? "result"
    : payload.phase === "planning"
      ? "idle"
      : payload.phase

  return {
    sessionId: typeof payload.sessionId === "string" ? payload.sessionId : "",
    draft: typeof payload.draft === "string" ? payload.draft : "",
    phase: nextPhase,
    agentStatus:
      hasPlan
        ? "登录后继续调整行程"
        : typeof payload.agentStatus === "string" && payload.agentStatus
          ? payload.agentStatus
          : "准备开始",
    streamSteps: Array.isArray(payload.streamSteps) ? payload.streamSteps.filter((item) => typeof item === "string") : [],
    errorMessage: hasPlan ? "" : (typeof payload.errorMessage === "string" ? payload.errorMessage : ""),
    messages: messages.length > 0 ? messages : [welcomeMessage],
    plan,
  }
}

export const useChatStore = defineStore("chat", {
  state: () => ({
    sessionId: "",
    draft: "",
    phase: "idle" as "idle" | "planning" | "result" | "error",
    agentStatus: "准备开始",
    streamSteps: [] as string[],
    errorMessage: "",
    currentMessageId: "",
    pendingAssistantText: "",
    messages: [welcomeMessage] as ChatMessage[],
    plan: null as Plan | null,
    awaitingClarify: null as { question: string; reason: string; defaultSuggestion?: string } | null,
  }),
  actions: {
    resetTransientState() {
      this.awaitingClarify = null
      this.streamSteps = []
      this.errorMessage = ''
      this.currentMessageId = ''
      this.pendingAssistantText = ''
    },
    persistState() {
      persistChatState({
        sessionId: this.sessionId,
        draft: this.draft,
        phase: this.phase,
        agentStatus: this.agentStatus,
        streamSteps: this.streamSteps,
        errorMessage: this.errorMessage,
        messages: this.messages,
        plan: this.plan,
      })
    },
    hydrateFromSessionStorage() {
      const payload = readPersistedChatState()

      if (!payload) {
        return
      }

      const sanitized = sanitizePersistedState(payload)

      this.sessionId = sanitized.sessionId
      this.draft = sanitized.draft
      this.phase = sanitized.phase
      this.agentStatus = sanitized.agentStatus
      this.streamSteps = sanitized.streamSteps
      this.errorMessage = sanitized.errorMessage
      this.messages = sanitized.messages
      this.plan = sanitized.plan
      this.currentMessageId = ""
      this.pendingAssistantText = ""
    },
    setSession(sessionId: string) {
      this.sessionId = sessionId
      this.persistState()
    },
    hydrateFromSessionMessages(messages: Message[], plan: Plan | null = null) {
      const history: ChatMessage[] = messages
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0)
        .map((m, i) => ({
          id: `${m.role}-${m.timestamp}-${i}`,
          role: m.role as Role,
          content: m.content,
        }))
        .map(sanitizeHistoryMessage)
      this.resetTransientState()
      this.phase = history.length > 0 ? 'result' : 'idle'
      this.agentStatus = history.length > 0 ? '上次行程已加载' : '准备开始'
      this.plan = plan
      this.draft = ''
      this.messages = history.length > 0 ? [welcomeMessage, ...history] : [welcomeMessage]
      this.persistState()
    },
    setDraft(value: string) {
      this.draft = value
      this.persistState()
    },
    beginPlanning(content: string) {
      this.phase = "planning"
      this.resetTransientState()
      this.agentStatus = planningMessages.thinking
      this.messages.push({
        id: `user-${Date.now()}`,
        role: "user",
        content
      })
      this.currentMessageId = `assistant-${Date.now()}`
      this.messages.push({
        id: this.currentMessageId,
        role: "assistant",
        content: ""
      })
      this.draft = ""
      this.persistState()
    },
    setAssistantContent(content: string) {
      const current = this.messages.find((message) => message.id === this.currentMessageId)

      if (current) {
        current.content = content
        this.persistState()
      }
    },
    handleStreamEvent(event: ChatStreamEvent) {
      const ws = useWorkspaceStore()
      switch (event.type) {
        case 'session':
          ws.sessionId = event.sessionId
          break
        case 'agent_step': {
          const labels: Record<string, string> = {
            extractor: '正在理解你的需求…',
            prefetch: '正在查询可选方案…',
            generator: '正在生成行程方案…',
          }
          if (event.status === 'start' || event.status === 'thinking') {
            this.agentStatus = labels[event.agent] ?? '正在处理…'
          }
          break
        }
        case 'token':
          this.pendingAssistantText += event.delta
          this.setAssistantContent(this.pendingAssistantText)
          break
        case 'plan_partial':
          if (event.plan) {
            ws.currentPlan = event.plan
          }
          break
        case 'plan':
          ws.currentPlan = event.plan
          ws.persistState()
          this.plan = event.plan
          this.awaitingClarify = null
          this.persistState()
          break
        case 'clarify_needed':
          this.awaitingClarify = {
            question: event.question,
            reason: event.reason,
            defaultSuggestion: event.defaultSuggestion,
          }
          ws.status = 'awaiting_user'
          break
        case 'done':
          if (event.converged) {
            ws.status = 'converged'
            this.agentStatus = '规划完成'
          }
          break
        case 'error':
          this.phase = 'error'
          this.errorMessage = event.message
          this.agentStatus = '生成失败'
          // Remove the blank in-progress assistant bubble and replace it
          // with an error-styled system bubble so the user sees red error
          // styling rather than a plain assistant message.
          if (this.currentMessageId) {
            this.messages = this.messages.filter((m) => m.id !== this.currentMessageId)
            this.currentMessageId = ''
          }
          this.messages.push({
            id: `error-${Date.now()}`,
            role: 'system',
            content: event.message,
          })
          this.persistState()
          break
      }
    },
    setInputError() {
      this.phase = "error"
      this.errorMessage = "告诉我你想去哪，我来帮你规划～"
      this.persistState()
    },
    setRequestError(message: string) {
      this.phase = "error"
      this.errorMessage = message
      this.agentStatus = "生成失败"
      // Remove the blank in-progress assistant bubble and replace it with
      // a red error-styled system bubble (uses .bubble-system CSS in ChatPanel).
      if (this.currentMessageId) {
        this.messages = this.messages.filter((m) => m.id !== this.currentMessageId)
        this.currentMessageId = ""
      }
      this.messages.push({
        id: `error-${Date.now()}`,
        role: "system",
        content: message,
      })
      this.persistState()
    },
    completePlannerResponse(message: string) {
      this.phase = "result"
      this.errorMessage = ""
      this.agentStatus = "规划完成"
      this.streamSteps = []
      this.pendingAssistantText = ""
      this.setAssistantContent(message)
      this.persistState()
    },
    handleAuthInterrupted() {
      this.phase = this.plan ? "result" : "idle"
      this.agentStatus = this.plan ? "登录后继续调整行程" : "登录后继续规划"
      this.streamSteps = []
      this.errorMessage = ""
      this.pendingAssistantText = ""
      if (this.currentMessageId) {
        this.messages = this.messages.filter((message) => message.id !== this.currentMessageId)
        this.currentMessageId = ""
      }
      this.persistState()
    },
    recoverPromptAfterAuth(content: string) {
      this.handleAuthInterrupted()

      const lastMessage = this.messages[this.messages.length - 1]
      if (lastMessage?.role === "user" && lastMessage.content === content) {
        this.messages.pop()
      }

      this.draft = content
      this.persistState()
    },
    resetConversation() {
      this.resetTransientState()
      this.phase = "idle"
      this.agentStatus = "准备开始"
      this.plan = null
      this.messages = [welcomeMessage]
      this.sessionId = ""
      this.draft = ""
      clearPersistedChatState()
    }
  }
})
