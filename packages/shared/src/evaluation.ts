import { z } from 'zod'

export const BlockerTypeEnum = z.enum([
  'missing_origin', 'missing_destination', 'missing_days',
  'missing_dates', 'missing_budget', 'unclear_preference', 'other',
])
export type BlockerType = z.infer<typeof BlockerTypeEnum>

export const SuggestedActionEnum = z.enum([
  'call_flyai_flight', 'call_flyai_train', 'call_flyai_hotel',
  'call_flyai_poi', 'rewrite_description', 'replace_item', 'reorder',
])
export type SuggestedAction = z.infer<typeof SuggestedActionEnum>

export const ItemIssueSchema = z.object({
  dayNum: z.number().int().positive(),
  itemIndex: z.number().int().nonnegative(),
  severity: z.enum(['high', 'medium', 'low']),
  category: z.enum(['transport', 'lodging', 'attraction', 'meal', 'coherence']),
  problem: z.string(),
  suggestedAction: SuggestedActionEnum,
  hints: z.record(z.string(), z.unknown()).optional(),
})
export type ItemIssue = z.infer<typeof ItemIssueSchema>

export const CriticReportSchema = z.object({
  qualityScore: z.number().min(0).max(100).default(0),
  blockers: z.array(z.object({
    type: BlockerTypeEnum,
    message: z.string(),
  })).default([]),
  itemIssues: z.array(ItemIssueSchema).default([]),
  globalIssues: z.array(z.string()).default([]),
})
export type CriticReport = z.infer<typeof CriticReportSchema>

export interface CombinedScore {
  overall: number
  transport: number | null
  lodging: number | null
  attraction: number | null
}

export interface EvaluationReport {
  ruleScore: import('./scoring.js').ItineraryScore
  llmScore: number
  combined: CombinedScore
  blockers: CriticReport['blockers']
  itemIssues: CriticReport['itemIssues']
  globalIssues: string[]
  converged: boolean
}
