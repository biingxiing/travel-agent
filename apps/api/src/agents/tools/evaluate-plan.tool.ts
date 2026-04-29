// apps/api/src/agents/tools/evaluate-plan.tool.ts
import type { SubagentTool, SubagentResult, EmitFn } from './types.js'
import type { SessionState } from '@travel-agent/shared'
import { evaluate } from '../evaluator.js'

export const evaluatePlanTool: SubagentTool = {
  name: 'call_evaluator',
  description: 'Score the travel plan and return an EvaluationReport with {combined: {overall, transport, lodging, attraction}, blockers, itemIssues, converged}. Call after call_generator or call_refiner. Reads plan and brief from session automatically — invoke with no arguments. Act on the result: converged=true → stop and write confirmation; blockers exist → call call_clarifier; score below threshold → call call_refiner if not yet called this run, otherwise stop. Call at most twice per run.',
  parametersSchema: {
    type: 'object',
    properties: {
      language: { type: 'string', description: 'Optional language override. Omit to use session.language.' },
    },
    required: [],
    additionalProperties: false,
  },
  isConcurrencySafe: () => true,
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
    await emit({ type: 'agent_step', agent: 'evaluator', status: 'evaluating' })
    const report = await evaluate(plan, brief, language)
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
