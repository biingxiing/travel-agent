// apps/api/src/agents/tools/evaluate-plan.tool.ts
import type { SubagentTool, SubagentResult, EmitFn } from './types.js'
import type { SessionState, Plan, TripBrief } from '@travel-agent/shared'
import { evaluate } from '../evaluator.js'

export const evaluatePlanTool: SubagentTool = {
  name: 'call_evaluator',
  description: 'Score the current travel plan. Returns an EvaluationReport with {combined: {overall, transport, lodging, attraction}, blockers, itemIssues, converged}. Call after call_generator or call_refiner.',
  parametersSchema: {
    type: 'object',
    properties: {
      plan: { type: 'object', description: 'The Plan JSON to evaluate.' },
      brief: { type: 'object', description: 'The TripBrief for scoring context.' },
      language: { type: 'string', description: 'Language for the LLM critic.' },
    },
    required: ['plan', 'brief', 'language'],
    additionalProperties: false,
  },
  isConcurrencySafe: () => true,
  async call(input, session: SessionState, emit: EmitFn): Promise<SubagentResult> {
    const { plan, brief, language } = input as { plan: Plan; brief: TripBrief; language: string }
    await emit({ type: 'agent_step', agent: 'evaluator', status: 'evaluating' })
    const report = await evaluate(plan, brief, language)

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
