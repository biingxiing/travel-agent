import { Hono } from 'hono'
import { skillRegistry } from '../registry/skill-registry.js'
import { agentRegistry } from '../registry/agent-registry.js'

export const registryRouter = new Hono()

// List installed skills
registryRouter.get('/skills', (c) => c.json(skillRegistry.list()))

// Uninstall a skill
registryRouter.delete('/skills/:name', (c) => {
  const removed = skillRegistry.uninstall(c.req.param('name'))
  return removed
    ? c.json({ ok: true })
    : c.json({ error: 'Skill not found' }, 404)
})

// List registered agents
registryRouter.get('/agents', (c) => c.json(agentRegistry.list()))

// Unregister an agent
registryRouter.delete('/agents/:name', (c) => {
  const removed = agentRegistry.unregister(c.req.param('name'))
  return removed
    ? c.json({ ok: true })
    : c.json({ error: 'Agent not found' }, 404)
})
