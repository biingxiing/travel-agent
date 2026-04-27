import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./extractor.js', () => ({ extractBrief: vi.fn() }))
vi.mock('./evaluator.js', () => ({ evaluate: vi.fn() }))
vi.mock('./generator.js', () => ({
  runInitial: vi.fn(),
  runRefine: vi.fn(),
}))
vi.mock('./prefetch.js', () => ({
  prefetchFlyaiContext: vi.fn(async () => []),
}))
vi.mock('./clarifier.js', () => ({
  generateClarification: vi.fn(async (_msgs: any, _brief: any, reason: string) => ({
    question: `clarify: ${reason}`,
    defaultSuggestion: reason === 'missing_dates' ? '按 2025-01-01 出发规划' : null,
  })),
}))
vi.mock('../config/eval.js', () => ({
  getEvalConfig: () => ({
    ruleWeight: 0.7, llmWeight: 0.3, threshold: 90, maxIter: 3,
    requiredCategories: ['transport','lodging','attraction'],
  }),
}))

import { runReactLoop } from './react-loop.js'
import { extractBrief } from './extractor.js'
import { evaluate } from './evaluator.js'
import { runInitial, runRefine } from './generator.js'
import type { SessionState, Plan } from '@travel-agent/shared'

const samplePlan: Plan = {
  title: 't', destinations: ['d'], days: 1, travelers: 1, pace: 'balanced',
  preferences: [], dailyPlans: [{ day: 1, items: [] }], tips: [], disclaimer: 'x',
}

function emptyReport(converged = false, blockers: any[] = []) {
  return {
    ruleScore: { overall: 80, grade: 'good',
      transport: { score: converged ? 95 : 80, count: 1, items: [], grade: 'good' },
      lodging: { score: converged ? 95 : 80, count: 1, items: [], grade: 'good' },
      attraction: { score: converged ? 95 : 80, count: 2, items: [], grade: 'good' },
      meal: { score: null, count: 0, items: [], grade: 'none' },
      coverage: { score: 80, daysWithTransport: 1, daysWithLodging: 1, daysWithAttractions: 1, totalDays: 1 },
      suggestions: [],
    },
    llmScore: 80,
    combined: { overall: 80, transport: converged ? 95 : 80, lodging: converged ? 95 : 80, attraction: converged ? 95 : 80 },
    blockers, itemIssues: [], globalIssues: [],
    converged,
  }
}

async function collect(gen: AsyncGenerator<any>) {
  const events: any[] = []
  for await (const e of gen) events.push(e)
  return events
}

describe('runReactLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function baseSession(): SessionState {
    return {
      id: 's1', userId: 'u1', title: null, brief: null,
      messages: [{ role: 'user', content: '北京 3 天', timestamp: 1 }],
      currentPlan: null, currentScore: null, status: 'draft',
      iterationCount: 0, lastRunId: 'r1', pendingClarification: null,
      prefetchContext: [],   // new field
      language: 'zh',        // new field
      createdAt: 1, updatedAt: 1,
    }
  }

  it('clarify if extractor returns incomplete brief', async () => {
    ;(extractBrief as any).mockResolvedValue({
      brief: { destinations: [], days: 0, travelers: 1, preferences: [] },
      intent: 'new', changedFields: [],
    })
    const session = baseSession()
    const events = await collect(runReactLoop(session, 'r1'))
    expect(events.some((e) => e.type === 'clarify_needed')).toBe(true)
  })

  it('runs initial generation then converges immediately', async () => {
    ;(extractBrief as any).mockResolvedValue({
      brief: { destinations: ['d'], days: 1, travelers: 1, preferences: [], travelDates: { start: '2025-01-01', end: '2025-01-02' } },
      intent: 'new', changedFields: [],
    })
    ;(runInitial as any).mockImplementation(async function* () {
      yield { type: 'token', delta: '生成中' }
      yield { type: 'plan', plan: samplePlan }
      yield { type: 'done', messageId: 'm1' }
      return samplePlan
    })
    ;(evaluate as any).mockResolvedValue(emptyReport(true))
    const session = baseSession()
    const events = await collect(runReactLoop(session, 'r1'))
    expect(events.some((e) => e.type === 'plan')).toBe(true)
    expect(events.some((e) => e.type === 'score' && e.converged)).toBe(true)
    expect(session.status).toBe('converged')
  })

  it('hits max iter, emits max_iter_reached', async () => {
    ;(extractBrief as any).mockResolvedValue({
      brief: { destinations: ['d'], days: 1, travelers: 1, preferences: [], travelDates: { start: '2025-01-01', end: '2025-01-02' } },
      intent: 'new', changedFields: [],
    })
    ;(runInitial as any).mockImplementation(async function* () { yield { type: 'plan', plan: samplePlan }; return samplePlan })
    ;(evaluate as any).mockResolvedValue(emptyReport(false))
    ;(runRefine as any).mockResolvedValue(samplePlan)
    const session = baseSession()
    const events = await collect(runReactLoop(session, 'r1'))
    const last = [...events].reverse().find((e: any) => e.type === 'max_iter_reached')
    expect(last).toBeDefined()
    expect(session.status).toBe('awaiting_user')
  })

  it('aborts when runId mismatches', async () => {
    const session = baseSession()
    ;(extractBrief as any).mockResolvedValue({
      brief: { destinations: ['d'], days: 1, travelers: 1, preferences: [], travelDates: { start: '2025-01-01', end: '2025-01-02' } },
      intent: 'new', changedFields: [],
    })
    ;(runInitial as any).mockImplementation(async function* () { yield { type: 'plan', plan: samplePlan }; return samplePlan })
    ;(evaluate as any).mockImplementation(async () => {
      session.lastRunId = 'r2'  // simulate concurrent new request
      return emptyReport(false)
    })
    const events = await collect(runReactLoop(session, 'r1'))
    expect(events.find((e: any) => e.type === 'plan')).toBeDefined()
    // After mismatch, refine should NOT run; max_iter_reached should NOT emit
    expect(events.find((e: any) => e.type === 'max_iter_reached')).toBeUndefined()
  })

  it('runs evaluate then single refine when score is low', async () => {
    ;(extractBrief as any).mockResolvedValue({
      brief: { destinations: ['Beijing'], days: 3, travelers: 1, preferences: [], travelDates: { start: '2025-01-01', end: '2025-01-04' } },
      intent: 'new', changedFields: [],
    })
    ;(runInitial as any).mockImplementation(async function* () {
      yield { type: 'plan', plan: samplePlan }
      yield { type: 'done', messageId: 'msg1' }
      return samplePlan
    })
    ;(evaluate as any)
      .mockResolvedValueOnce(emptyReport(false))  // first eval: not converged
      .mockResolvedValueOnce(emptyReport(true))   // second eval: converged
    ;(runRefine as any).mockResolvedValue(samplePlan)

    const session = baseSession()
    const events = await collect(runReactLoop(session, 'r1'))

    // runRefine called exactly once
    expect(runRefine).toHaveBeenCalledTimes(1)
    // evaluate called twice (initial + after refine)
    expect(evaluate).toHaveBeenCalledTimes(2)
    // ends with done event
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('emits max_iter_reached if still not converged after single refine', async () => {
    ;(extractBrief as any).mockResolvedValue({
      brief: { destinations: ['Beijing'], days: 3, travelers: 1, preferences: [], travelDates: { start: '2025-01-01', end: '2025-01-04' } },
      intent: 'new', changedFields: [],
    })
    ;(runInitial as any).mockImplementation(async function* () {
      yield { type: 'plan', plan: samplePlan }
      yield { type: 'done', messageId: 'msg1' }
      return samplePlan
    })
    ;(evaluate as any).mockResolvedValue(emptyReport(false))  // never converges
    ;(runRefine as any).mockResolvedValue(samplePlan)

    const session = baseSession()
    const events = await collect(runReactLoop(session, 'r1'))

    expect(events.some((e) => e.type === 'max_iter_reached')).toBe(true)
    expect(runRefine).toHaveBeenCalledTimes(1)
  })
})
