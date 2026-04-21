import { randomUUID } from 'crypto'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { zValidator } from '@hono/zod-validator'
import { ChatRequestSchema } from '@travel-agent/shared'
import { createSession, getSession, getOrCreateSession, addMessage } from '../session/index.js'
import { runPlannerAgent } from '../agents/planner.js'
import type { ChatStreamEvent } from '@travel-agent/shared'

export const chatRouter = new Hono()

chatRouter.post('/sessions', (c) => {
  const session = createSession()
  return c.json({ sessionId: session.id }, 201)
})

chatRouter.get('/sessions/:id', (c) => {
  const session = getSession(c.req.param('id'))
  if (!session) return c.json({ error: 'Session not found' }, 404)
  return c.json({ sessionId: session.id, messages: session.messages })
})

chatRouter.post('/chat', zValidator('json', ChatRequestSchema), async (c) => {
  const { sessionId, message } = c.req.valid('json')
  const session = getOrCreateSession(sessionId)
  const messageId = randomUUID()

  addMessage(session.id, { role: 'user', content: message, timestamp: Date.now() })

  let assistantContent = ''

  return streamSSE(c, async (stream) => {
    const send = async (event: ChatStreamEvent) => {
      await stream.writeSSE({ data: JSON.stringify(event), event: event.type })
    }

    try {
      // Emit session event first
      await send({ type: 'session', sessionId: session.id, messageId })

      for await (const event of runPlannerAgent(session.messages)) {
        await send(event)
        if (event.type === 'token') assistantContent += event.delta
        if (event.type === 'done') break
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      await send({ type: 'error', code: 'PLANNER_ERROR', message: msg })
    } finally {
      if (assistantContent) {
        addMessage(session.id, {
          role: 'assistant',
          content: assistantContent,
          timestamp: Date.now(),
        })
      }
    }
  })
})
