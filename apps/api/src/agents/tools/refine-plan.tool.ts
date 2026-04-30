// apps/api/src/agents/tools/refine-plan.tool.ts
import type { SubagentTool, SubagentResult, EmitFn } from './types.js'
import type { SessionState } from '@travel-agent/shared'
import { runRefine } from '../generator.js'

export const refinePlanTool: SubagentTool = {
  name: 'call_refiner',
  description: 'Fix specific issues in the current itinerary identified by call_evaluator. Call at most once per run, only when the evaluation score is below threshold and no blockers are present. Reads plan, brief, evaluation report, and prefetch data from session automatically — invoke with no arguments. After refining, always call call_evaluator once more to get the updated score. Returns the repaired itinerary JSON.',
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
    const report = session.currentEvaluation ?? null
    if (!plan) return { type: 'ok', output: 'No plan in session — call call_generator first.' }
    if (!brief) return { type: 'ok', output: 'No TripBrief in session — call call_extractor first.' }
    if (!report) return { type: 'ok', output: 'No evaluation in session — call call_evaluator first.' }
    // prefetchContext is session-internal — always read from session, never from tool args.
    const prefetchContext = session.prefetchContext ?? []
    const language = typeof inp.language === 'string' && inp.language.length > 0
      ? inp.language
      : (session.language ?? 'zh')
    await emit({ type: 'agent_step', agent: 'generator', status: 'refining' })
    let refined: Awaited<ReturnType<typeof runRefine>>
    try {
      refined = await runRefine(plan, report, brief, prefetchContext, language)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await emit({ type: 'agent_step', agent: 'generator', status: 'done' })
      // Do NOT update session.currentPlan or reset session.currentScore — the plan is unchanged.
      return {
        type: 'ok',
        output: 'Refiner failed to produce a valid plan (' + msg + '). Retry call_refiner or call call_generator for a fresh plan.',
      }
    }
    session.currentPlan = refined
    session.currentScore = null
    session.iterationCount = (session.iterationCount ?? 0) + 1
    await emit({ type: 'plan', plan: refined })
    await emit({ type: 'agent_step', agent: 'generator', status: 'done' })
    return { type: 'ok', output: JSON.stringify(refined) }
  },
}
