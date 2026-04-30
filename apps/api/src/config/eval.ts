const DEFAULT_THRESHOLD = 90
const REQUIRED_CATEGORIES: ReadonlyArray<'transport' | 'lodging' | 'attraction'> = ['transport', 'lodging', 'attraction']

export interface EvalConfig {
  // Weight assigned to deterministic rule-based scoring. Always clamped to [0, 1].
  ruleWeight: number
  // Remaining weight assigned to the LLM score so the two weights sum to 1.
  llmWeight: number
  // Minimum score required for the evaluation to be considered acceptable.
  threshold: number
  // Upper bound for iterative evaluation or repair loops.
  maxIter: number
  // Categories that must appear in the generated travel plan.
  requiredCategories: ReadonlyArray<'transport' | 'lodging' | 'attraction'>
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

export function getEvalConfig(): EvalConfig {
  const ruleRaw = parseFloat(process.env.EVAL_RULE_WEIGHT ?? '0.7')
  // Env values are user-controlled, so fall back to defaults when parsing fails.
  const ruleWeight = clamp(Number.isFinite(ruleRaw) ? ruleRaw : 0.7, 0, 1)
  const threshold = parseInt(process.env.EVAL_THRESHOLD ?? String(DEFAULT_THRESHOLD), 10) || DEFAULT_THRESHOLD
  const maxIter = parseInt(process.env.EVAL_MAX_ITER ?? '10', 10) || 10

  const allowed = new Set(['transport', 'lodging', 'attraction'])
  const raw = process.env.EVAL_REQUIRED_CATEGORIES
  let requiredCategories: ReadonlyArray<'transport' | 'lodging' | 'attraction'>
  if (raw) {
    // Ignore unknown category names and fall back to the shared defaults if none survive.
    const parsed = raw.split(',').map((s) => s.trim()).filter((s) => allowed.has(s))
    requiredCategories = (parsed.length > 0 ? parsed : REQUIRED_CATEGORIES) as ReadonlyArray<'transport' | 'lodging' | 'attraction'>
  } else {
    requiredCategories = REQUIRED_CATEGORIES
  }

  return { ruleWeight, llmWeight: 1 - ruleWeight, threshold, maxIter, requiredCategories }
}
