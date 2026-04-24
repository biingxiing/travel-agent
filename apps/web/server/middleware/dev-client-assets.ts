import { access, readFile } from "node:fs/promises"
import { constants } from "node:fs"
import { join, normalize } from "node:path"
import { defineEventHandler, getRequestURL, setHeader } from "h3"

const CLIENT_ASSET_ROOT = join(process.cwd(), "apps/web/.nuxt/dist/client/_nuxt")

const CONTENT_TYPES: Record<string, string> = {
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
}

function contentTypeFor(pathname: string) {
  const ext = pathname.slice(pathname.lastIndexOf("."))
  return CONTENT_TYPES[ext] || "application/octet-stream"
}

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) {
    return
  }

  const pathname = getRequestURL(event).pathname

  if (!pathname.startsWith("/_nuxt/")) {
    return
  }

  if (pathname.startsWith("/_nuxt/builds/")) {
    return
  }

  const relativePath = pathname.replace(/^\/_nuxt\//, "")
  const safePath = normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "")
  const filePath = join(CLIENT_ASSET_ROOT, safePath)

  try {
    await access(filePath, constants.R_OK)
  } catch {
    return
  }

  const file = await readFile(filePath)
  setHeader(event, "content-type", contentTypeFor(filePath))
  return file
})
