import { z } from 'zod'
import { PlanSchema, rawPlanShape } from './plan.js'
import { BlockerTypeEnum } from './evaluation.js'

export const FollowupFieldEnum = z.enum([
  'destination', 'days', 'travelers', 'budget', 'preferences', 'pace',
])
export type FollowupField = z.infer<typeof FollowupFieldEnum>

export const FollowupEventSchema = z.object({
  type: z.literal('followup'),
  field: FollowupFieldEnum,
  question: z.string(),
  options: z.array(z.string()).min(1),
  multiSelect: z.boolean().default(false),
})
export type FollowupEvent = z.infer<typeof FollowupEventSchema>

export const ItemOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  patch: z.object({
    description: z.string().optional(),
    time: z.string().optional(),
    estimatedCost: z.object({ amount: z.number(), currency: z.string() }).optional(),
  }),
})
export type ItemOption = z.infer<typeof ItemOptionSchema>

export const ItemSelectionSchema = z.object({
  dayNum: z.number(),
  itemIndex: z.number(),
  itemTitle: z.string(),
  itemType: z.enum(['transport', 'lodging']),
  question: z.string(),
  options: z.array(ItemOptionSchema).min(1),
})
export type ItemSelection = z.infer<typeof ItemSelectionSchema>

export const ItemOptionsEventSchema = z.object({
  type: z.literal('item_options'),
  selections: z.array(ItemSelectionSchema),
})
export type ItemOptionsEvent = z.infer<typeof ItemOptionsEventSchema>

export const ChatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session'), sessionId: z.string(), messageId: z.string() }),
  z.object({
    type: z.literal('agent_step'),
    agent: z.string(),
    skill: z.string().optional(),
    status: z.enum([
      'thinking', 'start', 'done', 'error',
      'evaluating', 'refining',
    ]),
    input: z.any().optional(),
    output: z.any().optional(),
  }),
  z.object({ type: z.literal('token'), delta: z.string() }),
  z.object({ type: z.literal('plan_partial'), plan: rawPlanShape.deepPartial() }),
  z.object({ type: z.literal('plan'), plan: PlanSchema }),
  FollowupEventSchema,
  ItemOptionsEventSchema,
  z.object({
    type: z.literal('iteration_progress'),
    iteration: z.number().int().positive(),
    maxIterations: z.number().int().positive(),
    currentScore: z.number(),
    targetScore: z.number(),
    status: z.enum(['evaluating', 'refining']),
  }),
  z.object({
    type: z.literal('score'),
    overall: z.number(),
    transport: z.number().nullable(),
    lodging: z.number().nullable(),
    attraction: z.number().nullable(),
    iteration: z.number().int().nonnegative(),
    converged: z.boolean(),
  }),
  z.object({
    type: z.literal('clarify_needed'),
    question: z.string(),
    reason: BlockerTypeEnum,
  }),
  z.object({
    type: z.literal('max_iter_reached'),
    currentScore: z.number(),
    plan: PlanSchema,
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
