import { defineStore } from "pinia"
import type { ChatStreamEvent, ItineraryScoreSummary } from "@travel-agent/shared"
import type { ChatMessage, ItemOption, ItemSelection, Plan, StreamEvent } from "~/types/itinerary"
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

function looksLikeStructuredOutput(content: string) {
  const normalized = content.trim()

  return normalized.startsWith("```json") || normalized.startsWith("{") || normalized.startsWith("[")
}

function buildPlanSummary(plan: Plan) {
  const budget = plan.estimatedBudget
    ? `，预估 ${plan.estimatedBudget.currency} ${plan.estimatedBudget.amount}`
    : ""

  const preferenceText =
    plan.preferences && plan.preferences.length > 0
      ? `，重点偏向 ${plan.preferences.join(" / ")}`
      : ""

  return `已为你生成 ${plan.days} 天 ${plan.travelers} 人的 ${plan.destination} 行程${budget}${preferenceText}。右侧可以直接查看每天安排，如果想调整告诉我就行。`
}

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
    messages: [welcomeMessage] as ChatMessage[],
    plan: null as Plan | null,
    pendingSelections: [] as ItemSelection[],
    iteration: 0,
    maxIterations: 10,
    displayScore: null as number | null,
    targetScore: 90,
    loopStatus: null as 'evaluating' | 'refining' | null,
    awaitingClarify: null as { question: string; reason: string } | null,
    maxIterReached: null as { currentScore: number } | null,
    canContinue: false
  }),
  actions: {
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
    setDraft(value: string) {
      this.draft = value
      this.persistState()
    },
    beginPlanning(content: string) {
      this.phase = "planning"
      this.errorMessage = ""
      this.agentStatus = planningMessages.thinking
      this.streamSteps = []
      this.pendingAssistantText = ""
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
    appendAssistantToken(delta: string) {
      this.pendingAssistantText += delta
    },
    appendStreamStep(step: string) {
      if (!this.streamSteps.includes(step)) {
        this.streamSteps.push(step)
      }
    },
    handleStreamEvent(event: ChatStreamEvent) {
      const ws = useWorkspaceStore()
      switch (event.type) {
        case 'session':
          ws.sessionId = event.sessionId
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
          this.awaitingClarify = null
          this.maxIterReached = null
          break
        case 'clarify_needed':
          this.awaitingClarify = { question: event.question, reason: event.reason }
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
      }
    },
    applyStreamEvent(event: StreamEvent) {
      if (event.type === "session") {
        this.sessionId = event.sessionId
        this.persistState()
        return
      }

      if (event.type === "agent_step") {
        if (event.agent === "optimizer") {
          if (event.status === "thinking") {
            this.agentStatus = "正在查询可选方案…"
            this.appendStreamStep("正在为交通和住宿生成可选方案")
          }
          if (event.status === "done") {
            this.agentStatus = "方案已就绪，请确认选择"
            this.appendStreamStep("可选方案已生成，请在右侧选择")
          }
        } else {
          this.agentStatus = planningMessages[event.status]
          if (event.status === "thinking") {
            this.appendStreamStep("已理解需求，正在拆解规划任务")
          }
          if (event.status === "start") {
            this.appendStreamStep("已开始生成行程和预算建议")
          }
          if (event.status === "done") {
            this.appendStreamStep("已完成规划，正在整理最终方案")
          }
        }
        return
      }

      if (event.type === "token") {
        this.appendAssistantToken(event.delta)
        return
      }

      if (event.type === "plan_partial" && event.plan.dailyPlans) {
        this.appendStreamStep(`已生成 ${event.plan.dailyPlans.length} 天的部分行程`)
        return
      }

      if (event.type === "plan") {
        this.plan = event.plan
        this.phase = "result"
        this.pendingAssistantText = ""
        this.pendingSelections = []
        this.setAssistantContent(buildPlanSummary(event.plan))
        this.appendStreamStep("行程卡片已生成，可继续追问修改")
        this.persistState()
        return
      }

      if (event.type === "item_options") {
        this.pendingSelections = event.selections
        this.persistState()
        return
      }

      if (event.type === "done") {
        this.agentStatus = this.pendingSelections.length > 0 ? "方案已就绪，请确认选择" : "规划完成"
        if (!this.plan && this.pendingAssistantText.trim()) {
          this.setAssistantContent(
            looksLikeStructuredOutput(this.pendingAssistantText)
              ? "行程已生成，请查看右侧卡片。"
              : this.pendingAssistantText.trim()
          )
          this.pendingAssistantText = ""
        }
        if (this.phase !== "result") {
          this.phase = "idle"
        }
        this.persistState()
        return
      }

      if (event.type === "error") {
        this.phase = "error"
        this.errorMessage = event.message
        this.agentStatus = "生成失败"
        this.setAssistantContent(event.message)
        this.persistState()
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
      this.setAssistantContent(message)
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
        item.desc = option.patch.description
      }
      if (option.patch.time) {
        item.time = option.patch.time
      }
      if (option.patch.estimatedCost) {
        item.estimatedCost = option.patch.estimatedCost
      }

      this.pendingSelections = this.pendingSelections.filter(
        (selection) => !(selection.dayNum === dayNum && selection.itemIndex === itemIndex),
      )
      this.agentStatus = this.pendingSelections.length > 0 ? "方案已就绪，请确认选择" : "规划完成"
      this.persistState()
    },
    resetConversation() {
      this.phase = "idle"
      this.agentStatus = "准备开始"
      this.streamSteps = []
      this.errorMessage = ""
      this.plan = null
      this.pendingSelections = []
      this.currentMessageId = ""
      this.pendingAssistantText = ""
      this.messages = [welcomeMessage]
      this.sessionId = ""
      this.draft = ""
      clearPersistedChatState()
    }
  }
})
