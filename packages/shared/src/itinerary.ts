import { z } from 'zod'

export const ItineraryItemSchema = z.object({
  time: z.string().optional(),
  type: z.enum(['attraction', 'restaurant', 'transport', 'hotel', 'activity']),
  title: z.string(),
  desc: z.string(),
  tips: z.string().optional(),
})

export const DailyPlanSchema = z.object({
  day: z.number(),
  theme: z.string().optional(),
  items: z.array(ItineraryItemSchema),
})

export const EstimatedBudgetSchema = z.object({
  amount: z.number(),
  currency: z.string().default('CNY'),
  note: z.string().optional(),
})

export const ItinerarySchema = z.object({
  title: z.string().optional(),
  destination: z.string(),
  origin: z.string().optional(),
  duration: z.number(),
  travelers: z.number().default(1),
  dailyPlans: z.array(DailyPlanSchema),
  estimatedBudget: EstimatedBudgetSchema.optional(),
  tips: z.array(z.string()).optional(),
  disclaimer: z.string().default('本行程由 AI 生成，仅供参考，出行前请核对最新信息。'),
})

export type ItineraryItem = z.infer<typeof ItineraryItemSchema>
export type DailyPlan = z.infer<typeof DailyPlanSchema>
export type EstimatedBudget = z.infer<typeof EstimatedBudgetSchema>
export type Itinerary = z.infer<typeof ItinerarySchema>

// Chat message types
export const MessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.number(),
})

export const ChatRequestSchema = z.object({
  sessionId: z.string().optional(),
  message: z.string(),
})

export type Message = z.infer<typeof MessageSchema>
export type ChatRequest = z.infer<typeof ChatRequestSchema>

// SSE event types
export type SSEEvent =
  | { type: 'token'; content: string }
  | { type: 'agent_status'; status: string }
  | { type: 'itinerary'; data: Itinerary }
  | { type: 'error'; message: string }
  | { type: 'done' }
