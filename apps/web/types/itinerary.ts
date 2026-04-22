export type Role = "assistant" | "user" | "system"

export interface ChatMessage {
  id: string
  role: Role
  content: string
}

export interface PlanItem {
  time?: string
  type: string
  title: string
  description?: string
  desc?: string
  durationMinutes?: number
  location?: {
    name: string
    city?: string
    lat?: number
    lng?: number
  }
  estimatedCost?: {
    amount: number
    currency: string
  }
  tips?: string[] | string
}

export interface DailyPlan {
  day: number
  theme: string
  items: PlanItem[]
}

export interface EstimatedBudget {
  amount: number
  currency: string
  note?: string
}

export interface Plan {
  title: string
  destination: string
  originCity?: string
  days: number
  travelers: number
  pace?: string
  preferences?: string[]
  dailyPlans: DailyPlan[]
  estimatedBudget?: EstimatedBudget
  tips: string[]
  disclaimer: string
}

export interface SessionEvent {
  type: "session"
  sessionId: string
  messageId: string
}

export interface AgentStepEvent {
  type: "agent_step"
  agent: string
  status: "thinking" | "start" | "done"
}

export interface TokenEvent {
  type: "token"
  delta: string
}

export interface PlanPartialEvent {
  type: "plan_partial"
  plan: Partial<Plan>
}

export interface PlanEvent {
  type: "plan"
  plan: Plan
}

export interface ItemOption {
  id: string
  label: string
  description: string
  patch: {
    description?: string
    time?: string
    estimatedCost?: { amount: number; currency: string }
  }
}

export interface ItemSelection {
  dayNum: number
  itemIndex: number
  itemTitle: string
  itemType: "transport" | "lodging"
  question: string
  options: ItemOption[]
}

export interface ItemOptionsEvent {
  type: "item_options"
  selections: ItemSelection[]
}

export interface DoneEvent {
  type: "done"
  messageId?: string
  usage?: unknown
}

export interface ErrorEvent {
  type: "error"
  code?: string
  message: string
}

export type StreamEvent =
  | SessionEvent
  | AgentStepEvent
  | TokenEvent
  | PlanPartialEvent
  | PlanEvent
  | ItemOptionsEvent
  | DoneEvent
  | ErrorEvent
