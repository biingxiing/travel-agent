import { z } from 'zod'

export const TripBriefSchema = z.object({
  destination: z.string(),
  days: z.number().int().nonnegative(),
  originCity: z.string().optional(),
  travelers: z.number().int().positive().default(1),
  travelDates: z.object({
    start: z.string(),
    end: z.string(),
  }).optional(),
  budget: z.object({
    amount: z.number().nonnegative(),
    currency: z.string().default('CNY'),
  }).optional(),
  preferences: z.array(z.string()).default([]),
  pace: z.enum(['relaxed', 'balanced', 'packed']).optional(),
  notes: z.string().optional(),
})

export type TripBrief = z.infer<typeof TripBriefSchema>

export function isBriefMinimallyComplete(b: Partial<TripBrief>): boolean {
  return !!b.destination && !!b.days && b.days > 0
}

export function mergeBrief(prev: TripBrief, patch: Partial<TripBrief>): TripBrief {
  return TripBriefSchema.parse({ ...prev, ...patch })
}
