export {
  scorePlan, gradeFromScore, isConverged,
  REQUIRED_CATEGORIES, DEFAULT_THRESHOLD,
} from '@travel-agent/shared'
export type {
  Grade, ScoreCheck, ItemScore, CategoryScore, CoverageScore, ItineraryScore,
} from '@travel-agent/shared'

import type { Grade, ItemScore, ItineraryScore, Plan } from '@travel-agent/shared'

export function gradeColor(g: Grade): string {
  const map: Record<Grade, string> = {
    excellent: '#10b981', good: '#6366f1', fair: '#f59e0b',
    poor: '#ef4444', none: '#d1d5db',
  }
  return map[g]
}

export function gradeLabel(g: Grade): string {
  const map: Record<Grade, string> = {
    excellent: '优秀', good: '良好', fair: '一般', poor: '欠缺', none: 'N/A',
  }
  return map[g]
}

// Returns a map keyed by "${day.day}-${itemIndex}" → ItemScore
export function buildItemScoreMap(plan: Plan, score: ItineraryScore): Map<string, ItemScore> {
  const map = new Map<string, ItemScore>()

  const byKey = new Map<string, ItemScore>()
  for (const scored of [
    ...score.transport.items,
    ...score.lodging.items,
    ...score.attraction.items,
    ...score.meal.items,
  ]) {
    byKey.set(`${scored.type}::${scored.title}`, scored)
  }

  for (const day of plan.dailyPlans) {
    day.items.forEach((item, idx) => {
      const found = byKey.get(`${item.type}::${item.title}`)
      if (found) map.set(`${day.day}-${idx}`, found)
    })
  }
  return map
}
