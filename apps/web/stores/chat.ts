import { defineStore } from "pinia"
import type { ChatStreamEvent, ItineraryScoreSummary, Message, Plan, ItemOption, ItemSelection } from "@travel-agent/shared"
import type { ChatMessage, Role } from "~/types/itinerary"
import { useWorkspaceStore } from "./workspace"

const welcomeMessage: ChatMessage = {
  id: "assistant-welcome",
  role: "assistant",
  content: "你好呀～告诉我你想去哪、几天、几个人，我来帮你安排行程～"
}

const planningMessages = {
  thinking: "正在理解你的需求…",
  start: "正在为你生成旅行方案…",
  done: "正在整理最终方案…"
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
  pendingSelections: ItemSelection[]
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

function sanitizePersistedState(payload: PersistedChatState) {
  const messages = normalizeMessages(payload.messages).filter((message) =>
    message.content.trim().length > 0 || message.id === welcomeMessage.id,
  )
  const plan = payload.plan ?? null
  const hasPlan = Boolean(plan)
  const nextPhase =
    payload.phase === "planning"
      ? hasPlan
        ? "result"
        : "idle"
      : payload.phase

  return {
    sessionId: typeof payload.sessionId === "string" ? payload.sessionId : "",
    draft: typeof payload.draft === "string" ? payload.draft : "",
    phase: nextPhase,
    agentStatus:
      typeof payload.agentStatus === "string" && payload.agentStatus
        ? payload.agentStatus
        : hasPlan
          ? "登录后继续调整行程"
          : "准备开始",
    streamSteps: Array.isArray(payload.streamSteps) ? payload.streamSteps.filter((item) => typeof item === "string") : [],
    errorMessage: typeof payload.errorMessage === "string" ? payload.errorMessage : "",
    messages: messages.length > 0 ? messages : [welcomeMessage],
    plan,
    pendingSelections: Array.isArray(payload.pendingSelections) ? payload.pendingSelections : [],
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
    reasoningText: "",
    messages: [welcomeMessage] as ChatMessage[],
    plan: null as Plan | null,
    pendingSelections: [] as ItemSelection[],
    iteration: 0,
    maxIterations: 10,
    displayScore: null as number | null,
    targetScore: 90,
    loopStatus: null as 'evaluating' | 'refining' | null,
    awaitingClarify: null as { question: string; reason: string; defaultSuggestion?: string } | null,
    maxIterReached: null as { currentScore: number } | null,
    canContinue: false
  }),
  actions: {
    resetTransientState() {
      this.iteration = 0
      this.maxIterations = 10
      this.displayScore = null
      this.loopStatus = null
      this.awaitingClarify = null
      this.maxIterReached = null
      this.canContinue = false
      this.streamSteps = []
      this.errorMessage = ''
      this.currentMessageId = ''
      this.pendingAssistantText = ''
      this.reasoningText = ''
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
        pendingSelections: this.pendingSelections,
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
      this.pendingSelections = sanitized.pendingSelections
      this.currentMessageId = ""
      this.pendingAssistantText = ""
    },
    setSession(sessionId: string) {
      this.sessionId = sessionId
      this.persistState()
    },
    hydrateFromSessionMessages(messages: Message[]) {
      const history: ChatMessage[] = messages
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0)
        .map((m, i) => ({
          id: `${m.role}-${m.timestamp}-${i}`,
          role: m.role as Role,
          content: m.content,
        }))
      this.resetTransientState()
      this.phase = history.length > 0 ? 'result' : 'idle'
      this.agentStatus = history.length > 0 ? '上次行程已加载' : '准备开始'
      this.plan = null
      this.pendingSelections = []
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
      this.pendingSelections = []
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
            evaluator: '正在评估行程质量…',
            critic: '正在分析改进点…',
          }
          if (event.status === 'refining') {
            this.agentStatus = '正在优化行程…'
          } else if (event.status === 'evaluating') {
            this.agentStatus = '正在评估行程质量…'
          } else if (event.status === 'start' || event.status === 'thinking') {
            this.agentStatus = labels[event.agent] ?? '正在处理…'
          }
          break
        }
        case 'token':
          this.pendingAssistantText += event.delta
          this.setAssistantContent(this.pendingAssistantText)
          break
        case 'tool_reasoning':
          this.reasoningText += event.delta
          break
        case 'assistant_say': {
          // A finalized "narration" message — orchestrator told the user something
          // before invoking a tool. Append as a separate bubble so the final answer
          // (delivered via 'token') stays visually distinct.
          this.messages.push({
            id: `narration-${crypto.randomUUID()}`,
            role: 'narration',
            content: event.content,
          })
          this.persistState()
          break
        }
        case 'plan_partial':
          if (event.plan) {
            ws.currentPlan = event.plan
          }
          break
        case 'followup':
          this.agentStatus = event.question
          break
        case 'iteration_progress':
          this.iteration = event.iteration
          this.maxIterations = event.maxIterations
          this.displayScore = event.currentScore
          this.targetScore = event.targetScore
          this.loopStatus = event.status
          break
        case 'score': {
          const summary: ItineraryScoreSummary = {
            overall: event.overall,
            transport: event.transport,
            lodging: event.lodging,
            attraction: event.attraction,
            iteration: event.iteration
          }
          ws.currentScore = summary
          this.displayScore = event.overall
          break
        }
        case 'plan':
          ws.currentPlan = event.plan
          this.plan = event.plan
          this.awaitingClarify = null
          this.maxIterReached = null
          this.persistState()
          break
        case 'item_options':
          this.pendingSelections = event.selections
          this.persistState()
          break
        case 'clarify_needed':
          this.awaitingClarify = {
            question: event.question,
            reason: event.reason,
            defaultSuggestion: event.defaultSuggestion,
          }
          this.canContinue = false
          ws.status = 'awaiting_user'
          break
        case 'max_iter_reached':
          this.maxIterReached = { currentScore: event.currentScore }
          this.canContinue = true
          ws.status = 'awaiting_user'
          break
        case 'done':
          this.loopStatus = null
          if (event.converged) {
            this.canContinue = false
            ws.status = 'converged'
          }
          break
        case 'error':
          this.phase = 'error'
          this.errorMessage = event.message
          this.agentStatus = '生成失败'
          this.loopStatus = null
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
      this.pendingSelections = []
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
    applyItemSelection(dayNum: number, itemIndex: number, option: ItemOption) {
      if (!this.plan) return

      const day = this.plan.dailyPlans.find((dailyPlan) => dailyPlan.day === dayNum)
      if (!day) return

      const item = day.items[itemIndex]
      if (!item) return

      if (option.patch.description) {
        item.description = option.patch.description
      }
      if (option.patch.time) {
        item.time = option.patch.time
      }
      if (option.patch.estimatedCost) {
        item.estimatedCost = option.patch.estimatedCost
      }

      // Keep workspace store in sync (single source of truth for rendered plan)
      const ws = useWorkspaceStore()
      ws.currentPlan = this.plan

      this.pendingSelections = this.pendingSelections.filter(
        (selection) => !(selection.dayNum === dayNum && selection.itemIndex === itemIndex),
      )
      this.agentStatus = this.pendingSelections.length > 0 ? "方案已就绪，请确认选择" : "规划完成"
      this.persistState()
    },
    resetConversation() {
      this.resetTransientState()
      this.phase = "idle"
      this.agentStatus = "准备开始"
      this.plan = null
      this.pendingSelections = []
      this.messages = [welcomeMessage]
      this.sessionId = ""
      this.draft = ""
      clearPersistedChatState()
    }
  }
})
