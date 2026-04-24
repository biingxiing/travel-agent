import { Hono } from 'hono'
import { skillRegistry } from '../registry/skill-registry.js'
import { agentRegistry } from '../registry/agent-registry.js'

export const registryRouter = new Hono()

registryRouter.get('/skills', (c) => c.json({ skills: skillRegistry.list() }))
registryRouter.get('/agents', (c) => c.json({ agents: agentRegistry.list() }))
