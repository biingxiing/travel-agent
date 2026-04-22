import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import {
  clearAuthSession,
  getAuthenticatedUsername,
  setAuthSession,
  verifyCredentials,
} from '../auth/session.js'

const LoginRequestSchema = z.object({
  username: z.string().trim().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
})

export const authRouter = new Hono()

authRouter.get('/auth/me', async (c) => {
  const username = await getAuthenticatedUsername(c)

  if (!username) {
    clearAuthSession(c)
    return c.json({ authenticated: false })
  }

  return c.json({ authenticated: true, username })
})

authRouter.post('/auth/login', zValidator('json', LoginRequestSchema), async (c) => {
  const { username, password } = c.req.valid('json')

  if (!verifyCredentials(username, password)) {
    clearAuthSession(c)
    return c.json({ error: '用户名或密码错误' }, 401)
  }

  await setAuthSession(c)

  return c.json({ ok: true, username })
})

authRouter.post('/auth/logout', (c) => {
  clearAuthSession(c)
  return c.json({ ok: true })
})
