import { timingSafeEqual } from 'crypto'
import type { Context } from 'hono'
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'
import { getAuthConfig } from './config.js'

const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30

function isSecureRequest(c: Context): boolean {
  const forwardedProto = c.req.header('x-forwarded-proto')

  if (forwardedProto) {
    return forwardedProto.split(',')[0]?.trim() === 'https'
  }

  return new URL(c.req.url).protocol === 'https:'
}

function buildCookieOptions(c: Context) {
  return {
    httpOnly: true,
    maxAge: AUTH_COOKIE_MAX_AGE,
    path: '/',
    sameSite: 'Lax' as const,
    secure: isSecureRequest(c),
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

export function verifyCredentials(username: string, password: string): boolean {
  const config = getAuthConfig()

  return safeEqual(username, config.username) && safeEqual(password, config.password)
}

export async function setAuthSession(c: Context): Promise<void> {
  const config = getAuthConfig()

  await setSignedCookie(
    c,
    config.cookieName,
    config.username,
    config.cookieSecret,
    buildCookieOptions(c),
  )
}

export function clearAuthSession(c: Context): void {
  const config = getAuthConfig()

  deleteCookie(c, config.cookieName, buildCookieOptions(c))
}

export async function getAuthenticatedUsername(c: Context): Promise<string | null> {
  const config = getAuthConfig()
  const cookieValue = await getSignedCookie(c, config.cookieSecret, config.cookieName)

  if (cookieValue !== config.username) {
    return null
  }

  return config.username
}
