import { defineEventHandler, getRequestHeaders, getRequestURL, readRawBody, sendStream, setResponseHeaders, setResponseStatus } from "h3"

// LOCAL_API_TARGET must be set by `pnpm dev` (scripts/dev.mjs injects it automatically).
// Running `pnpm dev:web` standalone will fail fast here rather than silently
// self-looping (the old hardcoded :3001 fallback pointed to the web server itself
// whenever ports shifted).
const LOCAL_API_TARGET = process.env.LOCAL_API_TARGET
if (!LOCAL_API_TARGET) {
  throw new Error(
    '[local-api-proxy] LOCAL_API_TARGET env var is required. Use `pnpm dev` instead of `pnpm dev:web` alone.'
  )
}

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) {
    return
  }

  const requestUrl = getRequestURL(event)
  const upstreamUrl = `${LOCAL_API_TARGET}${requestUrl.pathname}${requestUrl.search}`
  console.log("[local-api-proxy] ->", event.method, requestUrl.pathname, "=>", upstreamUrl)
  const headers = new Headers()

  for (const [key, value] of Object.entries(getRequestHeaders(event))) {
    if (value && key !== "host" && key !== "connection" && key !== "content-length") {
      headers.set(key, value)
    }
  }

  const body = ["GET", "HEAD"].includes(event.method) ? undefined : await readRawBody(event)
  const response = await fetch(upstreamUrl, {
    method: event.method,
    headers,
    body
  })
  console.log("[local-api-proxy] <-", response.status, upstreamUrl)

  // Forward status and headers explicitly so H3 knows what to send before the body.
  setResponseStatus(event, response.status, response.statusText)
  const forwardHeaders: Record<string, string> = {}
  response.headers.forEach((value, key) => { forwardHeaders[key] = value })
  setResponseHeaders(event, forwardHeaders)

  // Use sendStream so H3/Nitro pipes the ReadableStream directly to the socket
  // instead of buffering the entire body in memory first. This is required for
  // SSE responses — returning `new Response(response.body, ...)` causes H3 to
  // serialise the stream synchronously, blocking all SSE frames until the
  // upstream connection closes.
  return sendStream(event, response.body)
})
