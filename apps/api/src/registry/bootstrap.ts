import { skillRegistry } from './skill-registry.js'
import { agentRegistry } from './agent-registry.js'
import { runPlannerAgent } from '../agents/planner.js'

export function bootstrapRegistry(): void {
  // Install built-in skills
  skillRegistry.install(
    {
      name: 'itinerary',
      version: '1.0.0',
      description: '按天生成旅行行程，包含景点、餐饮、交通、住宿安排',
      parameters: {
        destination: { type: 'string', description: '目的地', required: true },
        duration: { type: 'number', description: '天数', required: true },
        travelers: { type: 'number', description: '人数' },
        preferences: { type: 'string', description: '偏好（美食/文化/户外等）' },
      },
    },
    async (args) => {
      return JSON.stringify({
        skill: 'itinerary',
        args,
        note: 'Handled by Planner Agent via LLM',
      })
    },
  )

  skillRegistry.install(
    {
      name: 'budget',
      version: '1.0.0',
      description: '估算旅行预算（交通、住宿、餐饮、活动）',
      parameters: {
        destination: { type: 'string', description: '目的地', required: true },
        duration: { type: 'number', description: '天数', required: true },
        travelers: { type: 'number', description: '人数' },
      },
    },
    async (args) => {
      return JSON.stringify({ skill: 'budget', args, note: 'Handled by Planner Agent via LLM' })
    },
  )

  skillRegistry.install(
    {
      name: 'poi',
      version: '1.0.0',
      description: '查询目的地景点、餐厅、活动信息',
      parameters: {
        destination: { type: 'string', description: '目的地', required: true },
        category: { type: 'string', description: '类别（景点/餐厅/活动）' },
      },
    },
    async (args) => {
      return JSON.stringify({ skill: 'poi', args, note: 'Handled by Planner Agent via LLM' })
    },
  )

  // Register built-in agents
  agentRegistry.register(
    {
      name: 'planner',
      version: '1.0.0',
      description: 'Planner Agent：理解旅行需求、追问信息、生成结构化行程规划',
      requiredSkills: ['itinerary', 'budget', 'poi'],
    },
    runPlannerAgent,
  )

  console.log('[Bootstrap] Registry initialized with built-in agents and skills')
}
