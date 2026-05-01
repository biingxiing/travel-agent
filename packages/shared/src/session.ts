import { z } from 'zod'
import { MessageSchema } from './chat.js'
import { TripBriefSchema } from './brief.js'
import { PlanSchema } from './plan.js'

export const SessionStatusEnum = z.enum([
  'draft', 'planning', 'awaiting_user', 'converged', 'error',
])
export type SessionStatus = z.infer<typeof SessionStatusEnum>

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
  // Current phase of the planning/refinement workflow.
  status: SessionStatusEnum,
  // Identifier of the most recent workflow run for tracing or deduplication.
  lastRunId: z.string().nullable().default(null),
  // Clarification question currently waiting for a user answer.
  pendingClarification: z.string().nullable().default(null),
  // Locked compact summary of earliest chat turns once history exceeds COMPACT_THRESHOLD.
  compactedHistory: z.string().nullable().default(null),
  // Cached context snippets prefetched for the next planning run.
  prefetchContext: z.array(z.string()).default([]),
  // Preferred output language for replies and itinerary content.
  language: z.string().default('zh'),
  // Unix timestamps in milliseconds.
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type SessionState = z.infer<typeof SessionStateSchema>
