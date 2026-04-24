import { REQUIRED_CATEGORIES, DEFAULT_THRESHOLD } from '@travel-agent/shared'

export interface EvalConfig {
  ruleWeight: number       // 0..1
  llmWeight: number        // 1 - ruleWeight
  threshold: number
  maxIter: number
  requiredCategories: ReadonlyArray<'transport' | 'lodging' | 'attraction'>
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

export function getEvalConfig(): EvalConfig {
  const ruleRaw = parseFloat(process.env.EVAL_RULE_WEIGHT ?? '0.7')
  const ruleWeight = clamp(Number.isFinite(ruleRaw) ? ruleRaw : 0.7, 0, 1)
  const threshold = parseInt(process.env.EVAL_THRESHOLD ?? String(DEFAULT_THRESHOLD), 10) || DEFAULT_THRESHOLD
  const maxIter = parseInt(process.env.EVAL_MAX_ITER ?? '10', 10) || 10

  const allowed = new Set(['transport', 'lodging', 'attraction'])
  const raw = process.env.EVAL_REQUIRED_CATEGORIES
  let requiredCategories: ReadonlyArray<'transport' | 'lodging' | 'attraction'>
  if (raw) {
    const parsed = raw.split(',').map((s) => s.trim()).filter((s) => allowed.has(s))
    requiredCategories = (parsed.length > 0 ? parsed : REQUIRED_CATEGORIES) as ReadonlyArray<'transport' | 'lodging' | 'attraction'>
  } else {
    requiredCategories = REQUIRED_CATEGORIES
  }

  return { ruleWeight, llmWeight: 1 - ruleWeight, threshold, maxIter, requiredCategories }
}
