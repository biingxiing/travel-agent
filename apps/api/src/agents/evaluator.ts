import { scorePlan, isConverged, type Plan, type TripBrief, type EvaluationReport } from '@travel-agent/shared'
import { criticReview } from './critic.js'
import { getEvalConfig } from '../config/eval.js'

export async function evaluate(plan: Plan, brief: TripBrief): Promise<EvaluationReport> {
  const cfg = getEvalConfig()
  const ruleScore = scorePlan(plan)
  const critic = await criticReview(plan, brief)
  const llmScore = critic.qualityScore

  const overallCombined = Math.round(cfg.ruleWeight * ruleScore.overall + cfg.llmWeight * llmScore)

  const combined = {
    overall: overallCombined,
    transport: ruleScore.transport.score,
    lodging: ruleScore.lodging.score,
    attraction: ruleScore.attraction.score,
  }

  // 收敛判据：用 rule 分（可重现可调试）
  const converged = isConverged(ruleScore, cfg.threshold) &&
    cfg.requiredCategories.every((cat) => ruleScore[cat].score !== null)

  return {
    ruleScore, llmScore, combined,
    blockers: critic.blockers,
    itemIssues: critic.itemIssues,
    globalIssues: critic.globalIssues,
    converged,
  }
}
