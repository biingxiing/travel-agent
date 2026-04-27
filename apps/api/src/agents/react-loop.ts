import { randomUUID } from 'crypto'
import { extractBrief } from './extractor.js'
import { evaluate } from './evaluator.js'
import { runInitial, runRefine } from './generator.js'
import { prefetchFlyaiContext } from './prefetch.js'
import { generateClarification } from './clarifier.js'
import { getEvalConfig } from '../config/eval.js'
import {
  isBriefMinimallyComplete,
  type SessionState, type ChatStreamEvent, type ItineraryScoreSummary, type Plan,
} from '@travel-agent/shared'

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
  const language = session.language ?? 'zh'

  // Phase 0: Extract brief
  yield { type: 'agent_step', agent: 'extractor', status: 'thinking' }
  const ext = await extractBrief(session.messages, session.brief)
  session.brief = ext.brief

  if (!isBriefMinimallyComplete(ext.brief)) {
    const missingDest = !ext.brief.destinations?.length
    const reason = missingDest ? 'missing_destination' : 'missing_days'
    const { question, defaultSuggestion } = await generateClarification(
      session.messages, ext.brief, reason, language,
    )
    session.status = 'awaiting_user'
    session.pendingClarification = question
    yield { type: 'clarify_needed', question, reason, ...(defaultSuggestion !== null && { defaultSuggestion }) }
    return
  }

  // Phase 0.5: ask for travel dates if missing
  if (!ext.brief.travelDates) {
    const { question, defaultSuggestion } = await generateClarification(
      session.messages, ext.brief, 'missing_dates', language,
    )
    session.status = 'awaiting_user'
    session.pendingClarification = question
    yield { type: 'clarify_needed', question, reason: 'missing_dates', ...(defaultSuggestion !== null && { defaultSuggestion }) }
    return
  }

  if (isCancelled(session, runId)) return

  // Phase 1: Initial generation (only if no current plan, or user wants new trip)
  if (!session.currentPlan || ext.intent === 'new') {
    session.status = 'planning'
    session.iterationCount = 0

    yield { type: 'agent_step', agent: 'generator', status: 'thinking' }
    let prefetched: string[] = []
    try {
      prefetched = await prefetchFlyaiContext(ext.brief, session.id)
    } catch (err) {
      console.warn('[ReactLoop] prefetchFlyaiContext failed (continuing without):', err)
    }
    // Store prefetch so the single refine pass can reuse it without re-fetching
    session.prefetchContext = prefetched

    if (isCancelled(session, runId)) return

    let initial: Plan | null = null
    const gen = runInitial(ext.brief, prefetched, language)
    while (true) {
      const r = await gen.next()
      if (r.value && typeof r.value === 'object' && 'type' in r.value) {
        yield r.value as ChatStreamEvent
      }
      if (r.done) { initial = r.value as Plan | null; break }
    }
    if (!initial) return
    session.currentPlan = initial
    session.iterationCount = 1
  }

  // Phase 2: Evaluate once
  if (isCancelled(session, runId)) return
  session.status = 'refining'
  yield { type: 'agent_step', agent: 'evaluator', status: 'evaluating' }
  const report = await evaluate(session.currentPlan!, ext.brief, language)

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

  // Phase 3: Single refine pass
  if (isCancelled(session, runId)) return
  session.iterationCount++
  yield {
    type: 'iteration_progress',
    iteration: session.iterationCount,
    maxIterations: 2,
    currentScore: summary.overall,
    targetScore: cfg.threshold,
    status: 'refining',
  }
  yield { type: 'agent_step', agent: 'generator', status: 'refining' }
  const refined = await runRefine(
    session.currentPlan!, report, ext.brief,
    session.prefetchContext ?? [],
    language,
  )
  if (isCancelled(session, runId)) return
  session.currentPlan = refined
  yield { type: 'plan', plan: refined }

  // Final evaluation after refine
  yield { type: 'agent_step', agent: 'evaluator', status: 'evaluating' }
  const finalReport = await evaluate(refined, ext.brief, language)
  const finalSummary = summarize(finalReport, session.iterationCount)
  session.currentScore = finalSummary
  yield {
    type: 'score',
    overall: finalSummary.overall,
    transport: finalSummary.transport,
    lodging: finalSummary.lodging,
    attraction: finalSummary.attraction,
    iteration: session.iterationCount,
    converged: finalReport.converged,
  }

  if (finalReport.converged) {
    session.status = 'converged'
    session.pendingClarification = null
    yield { type: 'done', messageId: randomUUID(), converged: true }
    return
  }

  // Score still below threshold — surface to user for manual /continue
  session.status = 'awaiting_user'
  yield { type: 'max_iter_reached', currentScore: finalSummary.overall, plan: refined }
}
