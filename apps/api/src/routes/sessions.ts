import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../auth/middleware.js'
import { withSessionContext } from '../llm/logger.js'
import { sessionStore } from '../session/store.js'
import { runReactLoop } from '../agents/react-loop.js'
import type { ChatStreamEvent } from '@travel-agent/shared'

export const sessionsRouter = new Hono()
sessionsRouter.use('*', authMiddleware)

const SendMessageSchema = z.object({ content: z.string().min(1) })

function getUserId(c: any): string {
  const id = c.get('userId') as string | undefined
  if (!id) throw new Error('userId missing from context')
  return id
}

sessionsRouter.post('/', async (c) => {
  const userId = getUserId(c)
  const session = await sessionStore.create(userId)
  return c.json({ session }, 201)
})

sessionsRouter.get('/', async (c) => {
  const userId = getUserId(c)
  const sessions = await sessionStore.listByUser(userId)
  return c.json({ sessions })
})

sessionsRouter.get('/:id', async (c) => {
  const userId = getUserId(c)
  const session = await sessionStore.get(c.req.param('id'), userId)
  if (!session) return c.json({ error: 'Session not found' }, 404)
  return c.json({ session })
})

sessionsRouter.delete('/:id', async (c) => {
  const userId = getUserId(c)
  const ok = await sessionStore.delete(c.req.param('id'), userId)
  if (!ok) return c.json({ error: 'Session not found' }, 404)
  return c.json({ ok: true })
})

sessionsRouter.post('/:id/messages', zValidator('json', SendMessageSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const session = await sessionStore.get(id, userId)
  if (!session) return c.json({ error: 'Session not found' }, 404)

  const { content } = c.req.valid('json')
  await sessionStore.appendMessage(id, { role: 'user', content, timestamp: Date.now() })
  const runId = await sessionStore.updateRunId(id)
  if (!runId) return c.json({ error: 'Session vanished' }, 500)

  const fresh = await sessionStore.get(id, userId)
  if (!fresh) return c.json({ error: 'Session vanished' }, 500)

  return streamSSE(c, async (stream) => {
    const send = async (e: ChatStreamEvent) => {
      await stream.writeSSE({ data: JSON.stringify(e), event: e.type })
    }
    let assistantContent = ''
    try {
      await send({ type: 'session', sessionId: fresh.id, messageId: runId })
      await withSessionContext(fresh.id, runId, async () => {
        for await (const ev of runReactLoop(fresh, runId)) {
          await send(ev)
          if (ev.type === 'token') assistantContent += ev.delta
        }
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      await send({ type: 'error', code: 'LOOP_ERROR', message: msg })
    } finally {
      if (assistantContent) {
        await sessionStore.appendMessage(id, {
          role: 'assistant', content: assistantContent, timestamp: Date.now(),
        })
      }
      await sessionStore.save(fresh)
    }
  })
})

sessionsRouter.post('/:id/continue', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const session = await sessionStore.get(id, userId)
  if (!session) return c.json({ error: 'Session not found' }, 404)
  if (session.status !== 'awaiting_user') {
    return c.json({ error: 'Session not in awaiting_user state' }, 409)
  }

  // Reset iteration counter to allow another batch of EVAL_MAX_ITER rounds
  session.iterationCount = 0
  session.status = 'refining'
  await sessionStore.save(session)
  const runId = await sessionStore.updateRunId(id)
  if (!runId) return c.json({ error: 'Session vanished' }, 500)
  const fresh = await sessionStore.get(id, userId)
  if (!fresh) return c.json({ error: 'Session vanished' }, 500)

  return streamSSE(c, async (stream) => {
    const send = async (e: ChatStreamEvent) => {
      await stream.writeSSE({ data: JSON.stringify(e), event: e.type })
    }
    try {
      await send({ type: 'session', sessionId: fresh.id, messageId: runId })
      await withSessionContext(fresh.id, runId, async () => {
        for await (const ev of runReactLoop(fresh, runId)) await send(ev)
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      await send({ type: 'error', code: 'LOOP_ERROR', message: msg })
    } finally {
      await sessionStore.save(fresh)
    }
  })
})
