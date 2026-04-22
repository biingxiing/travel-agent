import type { MiddlewareHandler } from 'hono'
import { clearAuthSession, getAuthenticatedUsername } from './session.js'

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    return next()
  }

  if (c.req.path.startsWith('/api/auth')) {
    return next()
  }

  const username = await getAuthenticatedUsername(c)

  if (!username) {
    clearAuthSession(c)
    return c.json({ error: 'Unauthorized' }, 401)
  }

  await next()
}
