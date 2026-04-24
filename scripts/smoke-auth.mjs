import { readFileSync } from "node:fs"
import { resolve } from "node:path"

function parseEnvFile(filePath) {
  try {
    const content = readFileSync(filePath, "utf8")
    const values = {}

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim()

      if (!line || line.startsWith("#")) {
        continue
      }

      const separatorIndex = line.indexOf("=")

      if (separatorIndex === -1) {
        continue
      }

      const key = line.slice(0, separatorIndex).trim()
      const value = line.slice(separatorIndex + 1).trim()

      values[key] = value
    }

    return values
  } catch {
    return {}
  }
}

function getCookieHeader(response) {
  const setCookie = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean)

  return setCookie
    .map((item) => item.split(";")[0])
    .join("; ")
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => null)
  return { response, payload }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const repoRoot = resolve(import.meta.dirname, "..")
const envFromFile = parseEnvFile(resolve(repoRoot, "apps/api/.env"))
const baseUrl = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "")
const username = process.env.AUTH_USERNAME || envFromFile.AUTH_USERNAME
const password = process.env.AUTH_PASSWORD || envFromFile.AUTH_PASSWORD

assert(username, "Missing AUTH_USERNAME. Set env vars or configure apps/api/.env first.")
assert(password, "Missing AUTH_PASSWORD. Set env vars or configure apps/api/.env first.")

console.log(`Smoke auth check against ${baseUrl}`)

const initial = await requestJson(`${baseUrl}/api/auth/me`)
assert(initial.response.ok, `Expected GET /api/auth/me to succeed, got ${initial.response.status}`)
assert(initial.payload?.authenticated === false, `Expected unauthenticated status, got ${JSON.stringify(initial.payload)}`)
console.log("1. unauthenticated /api/auth/me OK")

const login = await requestJson(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ username, password })
})
assert(login.response.ok, `Expected POST /api/auth/login to succeed, got ${login.response.status}`)
assert(login.payload?.ok === true, `Expected login ok=true, got ${JSON.stringify(login.payload)}`)
const cookieHeader = getCookieHeader(login.response)
assert(cookieHeader, "Expected login response to set auth cookie")
console.log("2. login OK")

const afterLogin = await requestJson(`${baseUrl}/api/auth/me`, {
  headers: {
    Cookie: cookieHeader
  }
})
assert(afterLogin.response.ok, `Expected authenticated GET /api/auth/me to succeed, got ${afterLogin.response.status}`)
assert(afterLogin.payload?.authenticated === true, `Expected authenticated=true, got ${JSON.stringify(afterLogin.payload)}`)
console.log("3. authenticated /api/auth/me OK")

const logout = await requestJson(`${baseUrl}/api/auth/logout`, {
  method: "POST",
  headers: {
    Cookie: cookieHeader
  }
})
assert(logout.response.ok, `Expected POST /api/auth/logout to succeed, got ${logout.response.status}`)
assert(logout.payload?.ok === true, `Expected logout ok=true, got ${JSON.stringify(logout.payload)}`)
console.log("4. logout OK")

const clearedCookieHeader = getCookieHeader(logout.response) || cookieHeader

const afterLogout = await requestJson(`${baseUrl}/api/auth/me`, {
  headers: {
    Cookie: clearedCookieHeader
  }
})
assert(afterLogout.response.ok, `Expected final GET /api/auth/me to succeed, got ${afterLogout.response.status}`)
assert(afterLogout.payload?.authenticated === false, `Expected authenticated=false after logout, got ${JSON.stringify(afterLogout.payload)}`)
console.log("5. post-logout /api/auth/me OK")

console.log("Smoke auth check passed")
