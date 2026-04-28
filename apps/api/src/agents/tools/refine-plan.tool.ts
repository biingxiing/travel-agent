// apps/api/src/agents/tools/refine-plan.tool.ts
import type { SubagentTool, SubagentResult, EmitFn } from './types.js'
import type { SessionState, Plan, TripBrief, EvaluationReport } from '@travel-agent/shared'
import { runRefine } from '../generator.js'

export const refinePlanTool: SubagentTool = {
  name: 'call_refiner',
  description: 'Fix specific issues in the current itinerary identified by call_evaluator. Call at most once per run, only when the evaluation score is below threshold and no blockers are present. After refining, always call call_evaluator once more to get the updated score. Returns the repaired itinerary JSON.',
  parametersSchema: {
    type: 'object',
    properties: {
      plan: { type: 'object', description: 'The Plan JSON to refine.' },
      brief: { type: 'object', description: 'The TripBrief for context.' },
      report: { type: 'object', description: 'The EvaluationReport from call_evaluator.' },
      prefetchContext: {
        type: 'array',
        items: { type: 'string' },
        description: 'Prefetch context strings. Pass session.prefetchContext or [].',
      },
      language: { type: 'string', description: 'Output language.' },
    },
    required: ['plan', 'brief', 'report', 'prefetchContext', 'language'],
    additionalProperties: false,
  },
  isConcurrencySafe: () => false,
  async call(input, session: SessionState, emit: EmitFn): Promise<SubagentResult> {
    const { plan, brief, report, prefetchContext, language } = input as {
      plan: Plan
      brief: TripBrief
      report: EvaluationReport
      prefetchContext: string[]
      language: string
    }
    await emit({ type: 'agent_step', agent: 'generator', status: 'refining' })
    const refined = await runRefine(plan, report, brief, prefetchContext, language)
    session.currentPlan = refined
    session.iterationCount = (session.iterationCount ?? 0) + 1
    await emit({ type: 'plan', plan: refined })
    await emit({ type: 'agent_step', agent: 'generator', status: 'done' })
    return { type: 'ok', output: JSON.stringify(refined) }
  },
}
