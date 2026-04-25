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

export type { ItemOption, ItemSelection } from "@travel-agent/shared"
