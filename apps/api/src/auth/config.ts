import { z } from 'zod'

const AuthEnvSchema = z.object({
  AUTH_USERNAME: z.string().min(1, 'AUTH_USERNAME is required'),
  AUTH_PASSWORD: z.string().min(1, 'AUTH_PASSWORD is required'),
  AUTH_COOKIE_SECRET: z.string().min(16, 'AUTH_COOKIE_SECRET must be at least 16 characters'),
  AUTH_COOKIE_NAME: z.string().min(1).optional(),
})

export interface AuthConfig {
  username: string
  password: string
  cookieSecret: string
  cookieName: string
}

let cachedConfig: AuthConfig | null = null

export function getAuthConfig(): AuthConfig {
  if (cachedConfig) {
    return cachedConfig
  }

  const parsed = AuthEnvSchema.safeParse(process.env)

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ')
    throw new Error(`Invalid auth configuration: ${details}`)
  }

  cachedConfig = {
    username: parsed.data.AUTH_USERNAME,
    password: parsed.data.AUTH_PASSWORD,
    cookieSecret: parsed.data.AUTH_COOKIE_SECRET,
    cookieName: parsed.data.AUTH_COOKIE_NAME ?? 'travel_agent_auth',
  }

  return cachedConfig
}

export function assertAuthConfig(): void {
  getAuthConfig()
}
