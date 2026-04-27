import { z } from 'zod'
import { MessageSchema } from './chat.js'
import { TripBriefSchema } from './brief.js'
import { PlanSchema } from './plan.js'

export const SessionStatusEnum = z.enum([
  'draft', 'planning', 'refining', 'awaiting_user', 'converged', 'error',
])
export type SessionStatus = z.infer<typeof SessionStatusEnum>

export const ItineraryScoreSummarySchema = z.object({
  overall: z.number(),
  transport: z.number().nullable(),
  lodging: z.number().nullable(),
  attraction: z.number().nullable(),
  iteration: z.number().int().nonnegative(),
})
export type ItineraryScoreSummary = z.infer<typeof ItineraryScoreSummarySchema>

export const SessionStateSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string().nullable().default(null),
  brief: TripBriefSchema.nullable().default(null),
  messages: z.array(MessageSchema).default([]),
  currentPlan: PlanSchema.nullable().default(null),
  currentScore: ItineraryScoreSummarySchema.nullable().default(null),
  status: SessionStatusEnum,
  iterationCount: z.number().int().nonnegative().default(0),
  lastRunId: z.string().nullable().default(null),
  pendingClarification: z.string().nullable().default(null),
  prefetchContext: z.array(z.string()).default([]),  // new
  language: z.string().default('zh'),                // new
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type SessionState = z.infer<typeof SessionStateSchema>
