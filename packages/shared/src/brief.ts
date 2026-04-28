import { z } from 'zod'

const nullToUndefined = (v: unknown) => (v === null ? undefined : v)

export const rawBriefShape = z.object({
  destinations: z.array(z.string()).default([]),
  originCity: z.preprocess(nullToUndefined, z.string().optional()),
  days: z.number().int().nonnegative(),
  travelers: z.number().int().positive().default(1),
  travelDates: z.preprocess(
    nullToUndefined,
    z.object({
      start: z.string(),
      end: z.string(),
    }).optional(),
  ),
  budget: z.preprocess(
    nullToUndefined,
    z.object({
      amount: z.preprocess(nullToUndefined, z.number().nonnegative().optional()),
      currency: z.string().default('CNY'),
    }).optional(),
  ),
  preferences: z.array(z.string()).default([]),
  pace: z.preprocess(nullToUndefined, z.enum(['relaxed', 'balanced', 'packed']).optional()),
  notes: z.preprocess(nullToUndefined, z.string().optional()),
})

export const TripBriefSchema = z.preprocess((raw) => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>
    if (typeof r.destination === 'string' && !Array.isArray(r.destinations)) {
      r.destinations = [r.destination]
      delete r.destination
    }
  }
  return raw
}, rawBriefShape)

export type TripBrief = z.infer<typeof rawBriefShape>

export function isBriefMinimallyComplete(b: Partial<TripBrief>): boolean {
  return (b.destinations?.length ?? 0) > 0 && !!b.days && b.days > 0
}

export function mergeBrief(prev: TripBrief, patch: Partial<TripBrief>): TripBrief {
  return TripBriefSchema.parse({ ...prev, ...patch }) as TripBrief
}
