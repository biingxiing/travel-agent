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
  // Stable session identifier.
  id: z.string(),
  // User who owns this session.
  userId: z.string(),
  // User-facing session title; null until one is generated or assigned.
  title: z.string().nullable().default(null),
  // Normalized travel brief extracted from user input.
  brief: TripBriefSchema.nullable().default(null),
  // Full conversation history used to resume context.
  messages: z.array(MessageSchema).default([]),
  // Latest itinerary draft kept as the working plan.
  currentPlan: PlanSchema.nullable().default(null),
  // Evaluation summary for currentPlan; null before the first scoring pass.
  currentScore: ItineraryScoreSummarySchema.nullable().default(null),
  // Current phase of the planning/refinement workflow.
  status: SessionStatusEnum,
  // Number of generation/refinement rounds completed in this session.
  iterationCount: z.number().int().nonnegative().default(0),
  // Identifier of the most recent workflow run for tracing or deduplication.
  lastRunId: z.string().nullable().default(null),
  // Clarification question currently waiting for a user answer.
  pendingClarification: z.string().nullable().default(null),
  // Cached context snippets prefetched for the next planning run.
  prefetchContext: z.array(z.string()).default([]),
  // Preferred output language for replies and itinerary content.
  language: z.string().default('zh'),
  // Unix timestamps in milliseconds.
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type SessionState = z.infer<typeof SessionStateSchema>
