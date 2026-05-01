import { z } from 'zod'
import { PlanSchema, rawPlanShape } from './plan.js'

export const BlockerTypeEnum = z.enum([
  'missing_origin', 'missing_destination', 'missing_days',
  'missing_dates', 'missing_budget', 'unclear_preference', 'other',
])
export type BlockerType = z.infer<typeof BlockerTypeEnum>

export const ChatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session'), sessionId: z.string(), messageId: z.string() }),
  z.object({
    type: z.literal('agent_step'),
    // v2.0: 'orchestrator' | 'researcher' | legacy persona names. Kept open as string for forward-compat.
    agent: z.string(),
    skill: z.string().optional(),
    status: z.enum(['thinking', 'start', 'done', 'error']),
    input: z.any().optional(),
    output: z.any().optional(),
  }),
  z.object({ type: z.literal('token'), delta: z.string() }),
  z.object({ type: z.literal('plan_partial'), plan: rawPlanShape.deepPartial() }),
  z.object({ type: z.literal('plan'), plan: PlanSchema }),
  z.object({
    type: z.literal('clarify_needed'),
    question: z.string(),
    reason: BlockerTypeEnum,
    defaultSuggestion: z.string().optional(),
  }),
  z.object({
    type: z.literal('done'),
    messageId: z.string(),
    converged: z.boolean().optional(),
    usage: z.object({ prompt: z.number(), completion: z.number() }).optional(),
  }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
])
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>
