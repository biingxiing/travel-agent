import { defineStore } from "pinia"
import type { ChatMessage, Plan, StreamEvent } from "~/types/itinerary"

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
    plan: null as Plan | null
  }),
  actions: {
    setSession(sessionId: string) {
      this.sessionId = sessionId
    },
    setDraft(value: string) {
      this.draft = value
    },
    beginPlanning(content: string) {
      this.phase = "planning"
      this.errorMessage = ""
      this.agentStatus = planningMessages.thinking
      this.streamSteps = []
      this.pendingAssistantText = ""
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
    },
    setAssistantContent(content: string) {
      const current = this.messages.find((message) => message.id === this.currentMessageId)

      if (current) {
        current.content = content
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
    applyStreamEvent(event: StreamEvent) {
      if (event.type === "session") {
        this.sessionId = event.sessionId
        return
      }

      if (event.type === "agent_step") {
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
        this.setAssistantContent(buildPlanSummary(event.plan))
        this.appendStreamStep("行程卡片已生成，可继续追问修改")
        return
      }

      if (event.type === "done") {
        this.agentStatus = "规划完成"
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
        return
      }

      if (event.type === "error") {
        this.phase = "error"
        this.errorMessage = event.message
        this.agentStatus = "生成失败"
        this.setAssistantContent(event.message)
      }
    },
    setInputError() {
      this.phase = "error"
      this.errorMessage = "告诉我你想去哪，我来帮你规划～"
    },
    setRequestError(message: string) {
      this.phase = "error"
      this.errorMessage = message
      this.agentStatus = "生成失败"
      this.setAssistantContent(message)
    },
    resetConversation() {
      this.phase = "idle"
      this.agentStatus = "准备开始"
      this.streamSteps = []
      this.errorMessage = ""
      this.plan = null
      this.currentMessageId = ""
      this.pendingAssistantText = ""
      this.messages = [welcomeMessage]
      this.sessionId = ""
      this.draft = ""
    }
  }
})
