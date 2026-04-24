export function useApiBase() {
  const config = useRuntimeConfig()
  const configuredApiBase = (config.public.apiBase || "").trim()

  function resolveApiBase() {
    if (!import.meta.client) {
      return configuredApiBase
    }

    const origin = window.location.origin
    const isLocalBrowser =
      origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")
    const pointsToLocalApi =
      configuredApiBase.startsWith("http://localhost:3001") || configuredApiBase.startsWith("http://127.0.0.1:3001")

    if (isLocalBrowser && pointsToLocalApi) {
      return ""
    }

    return configuredApiBase
  }

  return {
    resolveApiBase
  }
}
