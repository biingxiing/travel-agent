import { z } from 'zod'

export const PlanItemSchema = z.object({
  time: z.string().optional(),
  type: z.enum(['attraction', 'meal', 'transport', 'lodging', 'activity', 'note']),
  title: z.string(),
  description: z.string().optional(),
  durationMinutes: z.number().optional(),
  location: z.object({
    name: z.string(),
    city: z.string().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
  }).optional(),
  estimatedCost: z.object({ amount: z.number(), currency: z.string() }).optional(),
  tips: z.array(z.string()).optional(),
})

export const DailyPlanSchema = z.object({
  day: z.number(),
  date: z.string().optional(),
  theme: z.string().optional(),
  items: z.array(PlanItemSchema),
})

export const EstimatedBudgetSchema = z.object({
  amount: z.number(),
  currency: z.string().default('CNY'),
  note: z.string().optional(),
  breakdown: z.array(z.object({
    category: z.enum(['transport', 'lodging', 'food', 'tickets', 'other']),
    amount: z.number(),
  })).optional(),
})

export const PlanSchema = z.object({
  title: z.string(),
  destination: z.string(),
  originCity: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  days: z.number(),
  travelers: z.number().default(1),
  pace: z.enum(['relaxed', 'balanced', 'packed']).default('balanced'),
  preferences: z.array(z.string()).default([]),
  dailyPlans: z.array(DailyPlanSchema),
  estimatedBudget: EstimatedBudgetSchema.optional(),
  tips: z.array(z.string()).default([]),
  disclaimer: z.string().default('本行程由 AI 生成，仅供参考。出行前请通过官方渠道核对最新信息。'),
})

export type PlanItem = z.infer<typeof PlanItemSchema>
export type DailyPlan = z.infer<typeof DailyPlanSchema>
export type EstimatedBudget = z.infer<typeof EstimatedBudgetSchema>
export type Plan = z.infer<typeof PlanSchema>
