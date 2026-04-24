import { joinRelativeURL } from "ufo"

const APP_BASE_URL = "/"
const BUILD_ASSETS_DIR = "/_nuxt/"
const CDN_URL = ""

export function baseURL() {
  return APP_BASE_URL
}

export function buildAssetsDir() {
  return BUILD_ASSETS_DIR
}

export function buildAssetsURL(...path) {
  return joinRelativeURL(publicAssetsURL(), buildAssetsDir(), ...path)
}

export function publicAssetsURL(...path) {
  const publicBase = CDN_URL || APP_BASE_URL
  return path.length ? joinRelativeURL(publicBase, ...path) : publicBase
}
