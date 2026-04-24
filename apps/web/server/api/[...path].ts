import { defineEventHandler, getRequestHeaders, getRequestURL, readRawBody } from "h3"

const LOCAL_API_TARGET = process.env.LOCAL_API_TARGET || "http://127.0.0.1:3001"

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

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  })
})
