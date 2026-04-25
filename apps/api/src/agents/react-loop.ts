import { randomUUID } from 'crypto'
import { extractBrief } from './extractor.js'
import { evaluate } from './evaluator.js'
import { runInitial, runRefine } from './generator.js'
import { prefetchFlyaiContext } from './prefetch.js'
import { getEvalConfig } from '../config/eval.js'
import { isBriefMinimallyComplete, type SessionState, type ChatStreamEvent, type ItineraryScoreSummary, type Plan } from '@travel-agent/shared'

function summarize(report: Awaited<ReturnType<typeof evaluate>>, iteration: number): ItineraryScoreSummary {
  return {
    overall: report.combined.overall,
    transport: report.combined.transport,
    lodging: report.combined.lodging,
    attraction: report.combined.attraction,
    iteration,
  }
}

function isCancelled(session: SessionState, runId: string): boolean {
  return session.lastRunId !== runId
}

export async function* runReactLoop(
  session: SessionState, runId: string,
): AsyncGenerator<ChatStreamEvent, void, void> {
  const cfg = getEvalConfig()

  // Phase 0: Extract brief
  yield { type: 'agent_step', agent: 'extractor', status: 'thinking' }
  const ext = await extractBrief(session.messages, session.brief)
  session.brief = ext.brief

  if (!isBriefMinimallyComplete(ext.brief)) {
    const missingDest = !ext.brief.destinations?.length
    const question = missingDest ? '请告诉我目的地是哪里？' : '请告诉我打算玩几天？'
    session.status = 'awaiting_user'
    session.pendingClarification = question
    yield {
      type: 'clarify_needed',
      question,
      reason: missingDest ? 'missing_destination' : 'missing_days',
    }
    return
  }

  if (isCancelled(session, runId)) return

  // Phase 1: Initial (only if no current plan, or intent === 'new')
  if (!session.currentPlan || ext.intent === 'new') {
    session.status = 'planning'
    session.iterationCount = 0
    // Prefetch real flyai data so the LLM can fill items deterministically.
    yield { type: 'agent_step', agent: 'generator', status: 'thinking' }
    let prefetched: string[] = []
    try {
      prefetched = await prefetchFlyaiContext(ext.brief, session.id)
    } catch (err) {
      console.warn('[ReactLoop] prefetchFlyaiContext failed (continuing without):', err)
    }
    if (isCancelled(session, runId)) return
    let initial: Plan | null = null
    const gen = runInitial(ext.brief, session.messages, prefetched)
    while (true) {
      const r = await gen.next()
      if (r.value && typeof r.value === 'object' && 'type' in r.value) {
        yield r.value as ChatStreamEvent
      }
      if (r.done) { initial = r.value as any; break }
    }
    if (!initial) return  // clarification or error
    session.currentPlan = initial
    session.iterationCount = 1
  }

  // Phase 2: ReAct loop
  session.status = 'refining'
  while (session.iterationCount <= cfg.maxIter) {
    if (isCancelled(session, runId)) return

    yield { type: 'agent_step', agent: 'evaluator', status: 'evaluating' }
    const report = await evaluate(session.currentPlan!, ext.brief)
    if (isCancelled(session, runId)) return

    const summary = summarize(report, session.iterationCount)
    session.currentScore = summary
    yield {
      type: 'score',
      overall: summary.overall,
      transport: summary.transport,
      lodging: summary.lodging,
      attraction: summary.attraction,
      iteration: session.iterationCount,
      converged: report.converged,
    }

    if (report.blockers.length > 0) {
      const b = report.blockers[0]
      session.status = 'awaiting_user'
      session.pendingClarification = b.message
      yield { type: 'clarify_needed', question: b.message, reason: b.type }
      return
    }

    if (report.converged) {
      session.status = 'converged'
      session.pendingClarification = null
      yield { type: 'done', messageId: randomUUID(), converged: true }
      return
    }

    if (session.iterationCount >= cfg.maxIter) {
      session.status = 'awaiting_user'
      yield {
        type: 'max_iter_reached',
        currentScore: summary.overall,
        plan: session.currentPlan!,
      }
      return
    }

    // Refine
    session.iterationCount++
    yield {
      type: 'iteration_progress',
      iteration: session.iterationCount,
      maxIterations: cfg.maxIter,
      currentScore: summary.overall,
      targetScore: cfg.threshold,
      status: 'refining',
    }
    yield { type: 'agent_step', agent: 'generator', status: 'refining' }
    const refined = await runRefine(session.currentPlan!, report, ext.brief)
    if (isCancelled(session, runId)) return
    session.currentPlan = refined
    yield { type: 'plan', plan: refined }
  }
}
