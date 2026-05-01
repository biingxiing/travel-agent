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

/**
 * Strip raw LLM preamble + JSON code blocks from assistant content before
 * persisting to session history. The generator emits 1-2 natural language
 * sentences followed by a ```json block; we keep only the prose preamble if
 * short, or replace with a clean placeholder when a JSON block is present so
 * reloaded sessions don't show "下面是可直接使用的完整 JSON：".
 */
function sanitizeAssistantContent(content: string): string {
  if (!content) return content
  // If it contains a JSON code block, drop everything from the ``` marker
  // and replace with a clean summary placeholder.
  if (content.includes('```json')) {
    const prose = content.slice(0, content.indexOf('```json')).trim()
    // If the prose ends with a colon (e.g. "…下面是可直接使用的完整 JSON："),
    // it's part of the preamble pattern — discard it too.
    if (!prose || prose.endsWith('：') || prose.endsWith(':')) {
      return '✅ 行程已生成'
    }
    return prose
  }
  // Strip plain markdown dumps: if the content contains markdown formatting
  // indicators (**bold**, ## headers, or list items), or is a long multi-line
  // block, replace with a clean placeholder.
  const hasMarkdown = content.includes('**') || content.includes('## ') || /^- /m.test(content)
  const isLongMultiline = content.length > 300 && content.includes('\n')
  if (hasMarkdown || isLongMultiline) {
    return '✅ 行程已生成'
  }
  return content
}

const SendMessageSchema = z.object({
  content: z.string().min(1),
  language: z.string().optional(),
})

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

  const { content, language } = c.req.valid('json')
  await sessionStore.appendMessage(id, { role: 'user', content, timestamp: Date.now() })
  const runId = await sessionStore.updateRunId(id)
  if (!runId) return c.json({ error: 'Session vanished' }, 500)

  const fresh = await sessionStore.get(id, userId)
  if (!fresh) return c.json({ error: 'Session vanished' }, 500)

  // Store language preference on session (set once; subsequent messages inherit)
  if (language && !fresh.language) {
    fresh.language = language
  }

  return streamSSE(c, async (stream) => {
    const send = async (e: ChatStreamEvent) => {
      await stream.writeSSE({ data: JSON.stringify(e), event: e.type })
    }
    let assistantContent = ''
    const sendAndCollect = async (e: ChatStreamEvent) => {
      if (e.type === 'token') assistantContent += e.delta
      await send(e)
    }
    try {
      await send({ type: 'session', sessionId: fresh.id, messageId: runId })
      await withSessionContext(fresh.id, runId, async () => {
        for await (const ev of runReactLoop(fresh, runId, sendAndCollect)) {
          await send(ev)
        }
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      await send({ type: 'error', code: 'LOOP_ERROR', message: msg })
      await send({ type: 'done', messageId: runId })
    } finally {
      if (assistantContent) {
        await sessionStore.appendMessage(id, {
          role: 'assistant', content: sanitizeAssistantContent(assistantContent), timestamp: Date.now(),
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

  session.status = 'planning'
  await sessionStore.save(session)
  const runId = await sessionStore.updateRunId(id)
  if (!runId) return c.json({ error: 'Session vanished' }, 500)
  const fresh = await sessionStore.get(id, userId)
  if (!fresh) return c.json({ error: 'Session vanished' }, 500)

  return streamSSE(c, async (stream) => {
    const send = async (e: ChatStreamEvent) => {
      await stream.writeSSE({ data: JSON.stringify(e), event: e.type })
    }
    let assistantContent = ''
    const sendAndCollect = async (e: ChatStreamEvent) => {
      if (e.type === 'token') assistantContent += e.delta
      await send(e)
    }
    try {
      await send({ type: 'session', sessionId: fresh.id, messageId: runId })
      await withSessionContext(fresh.id, runId, async () => {
        for await (const ev of runReactLoop(fresh, runId, sendAndCollect)) await send(ev)
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      await send({ type: 'error', code: 'LOOP_ERROR', message: msg })
      await send({ type: 'done', messageId: runId })
    } finally {
      if (assistantContent) {
        await sessionStore.appendMessage(id, {
          role: 'assistant', content: sanitizeAssistantContent(assistantContent), timestamp: Date.now(),
        })
      }
      await sessionStore.save(fresh)
    }
  })
})

