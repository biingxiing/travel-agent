import { useApiBase } from "~/composables/useApiBase"

interface AuthStatusResponse {
  authenticated: boolean
  username?: string
}

interface LoginResponse {
  ok: true
  username: string
}

interface ErrorResponse {
  error?: string
}

const AUTH_STATUS_TIMEOUT_MS = 5000
const AUTH_MUTATION_TIMEOUT_MS = 8000

async function readJson<T>(response: Response): Promise<T | null> {
  const contentType = response.headers.get("content-type") || ""

  if (!contentType.includes("application/json")) {
    return null
  }

  return (await response.json()) as T
}

export function useAuthApi() {
  const { resolveApiBase } = useApiBase()

  async function requestWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal
      })
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("认证服务响应超时，请确认 API 已启动后再试。")
      }

      throw new Error("无法连接认证服务，请确认 Web 和 API 服务都已启动。")
    } finally {
      clearTimeout(timer)
    }
  }

  async function fetchAuthStatus() {
    const apiBase = resolveApiBase()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), AUTH_STATUS_TIMEOUT_MS)

    let response: Response

    try {
      response = await fetch(`${apiBase}/api/auth/me`, {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal
      })
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("登录状态检查超时。请确认 API 已启动，且 `apps/api/.env` 已配置 `AUTH_USERNAME`、`AUTH_PASSWORD`、`AUTH_COOKIE_SECRET`。")
      }

      throw new Error("暂时无法确认登录状态，请确认 Web 和 API 服务都已启动。")
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      throw new Error("暂时无法确认登录状态，请确认前后端服务都已启动。")
    }

    return (await response.json()) as AuthStatusResponse
  }

  async function login(username: string, password: string) {
    const apiBase = resolveApiBase()
    const response = await requestWithTimeout(`${apiBase}/api/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username, password })
    }, AUTH_MUTATION_TIMEOUT_MS)

    const payload = await readJson<ErrorResponse & Partial<LoginResponse>>(response)

    if (response.status === 401) {
      throw new Error(payload?.error || "用户名或密码错误")
    }

    if (!response.ok || !payload?.ok || !payload.username) {
      throw new Error("登录失败，请稍后再试。")
    }

    return payload as LoginResponse
  }

  async function logout() {
    const apiBase = resolveApiBase()
    const response = await requestWithTimeout(`${apiBase}/api/auth/logout`, {
      method: "POST",
      credentials: "include"
    }, AUTH_MUTATION_TIMEOUT_MS)

    if (!response.ok) {
      throw new Error("退出登录失败，请稍后再试。")
    }
  }

  return {
    fetchAuthStatus,
    login,
    logout
  }
}
