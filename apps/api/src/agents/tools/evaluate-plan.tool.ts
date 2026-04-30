// apps/api/src/agents/tools/evaluate-plan.tool.ts
import type { SubagentTool, SubagentResult, EmitFn } from './types.js'
import type { SessionState } from '@travel-agent/shared'
import { evaluate } from '../evaluator.js'

// Maps each SessionState instance to the fingerprint of the last evaluated plan.
// Using WeakMap so entries are GC-ed when the session is dropped, with no schema changes.
const lastEvaluatedFingerprint = new WeakMap<SessionState, string>()

function planFingerprint(plan: object): string {
  const s = JSON.stringify(plan)
  return s.length + ':' + s.slice(0, 64)
}

export const evaluatePlanTool: SubagentTool = {
  name: 'call_evaluator',
  description: 'Score the travel plan and return an EvaluationReport with {combined: {overall, transport, lodging, attraction}, blockers, itemIssues, converged}. Call after call_generator or call_refiner. Reads plan and brief from session automatically — invoke with no arguments. STRICT result handling — you MUST follow these rules exactly, no exceptions:\n- converged=true → call no further tools; write a brief confirmation message to the user.\n- converged=false (score below threshold) → you MUST call call_refiner immediately. Do NOT emit any plain-text response, do NOT call call_clarifier, do NOT summarise the evaluation in prose. The only valid next action is call_refiner.\n- If blockers include missing_budget or other informational gaps, pass them to call_refiner as context; call_refiner will handle them. Never ask the user for clarification mid-loop via plain text.\nCall at most twice per run.',
  parametersSchema: {
    type: 'object',
    properties: {
      language: { type: 'string', description: 'Optional language override. Omit to use session.language.' },
    },
    required: [],
    additionalProperties: false,
  },
  isConcurrencySafe: () => false,
  async call(input, session: SessionState, emit: EmitFn): Promise<SubagentResult> {
    const inp = input as { language?: string }
    const plan = session.currentPlan ?? null
    const brief = session.brief ?? null
    if (!plan) {
      return {
        type: 'ok',
        output: 'No plan in session — call call_generator first.',
      }
    }
    if (!brief) {
      return {
        type: 'ok',
        output: 'No TripBrief in session — call call_extractor first.',
      }
    }
    const language = typeof inp.language === 'string' && inp.language.length > 0
      ? inp.language
      : (session.language ?? 'zh')

    // Fingerprint check: if the plan is identical to the last evaluated plan,
    // return the cached score instead of running the expensive LLM critic again.
    const fp = planFingerprint(plan)
    const prevFp = lastEvaluatedFingerprint.get(session)
    if (prevFp === fp && session.currentEvaluation && session.currentScore) {
      const cachedReport = session.currentEvaluation
      await emit({
        type: 'score',
        overall: cachedReport.combined.overall,
        transport: cachedReport.combined.transport,
        lodging: cachedReport.combined.lodging,
        attraction: cachedReport.combined.attraction,
        iteration: session.iterationCount,
        converged: cachedReport.converged,
      })
      await emit({
        type: 'agent_step',
        agent: 'evaluator',
        status: 'done',
        output: 'Score: ' + cachedReport.combined.overall + ', converged: ' + cachedReport.converged + ' (cached — plan unchanged)',
      })
      return { type: 'ok', output: JSON.stringify(cachedReport) }
    }

    await emit({ type: 'agent_step', agent: 'evaluator', status: 'evaluating' })
    const report = await evaluate(plan, brief, language)
    lastEvaluatedFingerprint.set(session, fp)
    session.currentEvaluation = report

    session.currentScore = {
      overall: report.combined.overall,
      transport: report.combined.transport,
      lodging: report.combined.lodging,
      attraction: report.combined.attraction,
      iteration: session.iterationCount,
    }

    await emit({
      type: 'score',
      overall: report.combined.overall,
      transport: report.combined.transport,
      lodging: report.combined.lodging,
      attraction: report.combined.attraction,
      iteration: session.iterationCount,
      converged: report.converged,
    })
    await emit({
      type: 'agent_step',
      agent: 'evaluator',
      status: 'done',
      output: `Score: ${report.combined.overall}, converged: ${report.converged}`,
    })
    return { type: 'ok', output: JSON.stringify(report) }
  },
}
