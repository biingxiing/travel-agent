import type { SessionState, Plan } from "@travel-agent/shared"
import { useApiBase } from "./useApiBase"

export interface TripHistoryEntry {
  sessionId: string
  title: string
  destination: string
  days: number
  poiCount: number
  cityCount: number
  updatedAt: string
}

const STORAGE_KEY = "travel-agent.trips.index"
const MAX_ENTRIES = 24

const COVER_PALETTES: string[] = [
  "linear-gradient(135deg, #7B5BFF 0%, #4F7CFF 100%)",
  "linear-gradient(135deg, #06B6D4 0%, #3B82F6 100%)",
  "linear-gradient(135deg, #F59E0B 0%, #EF4444 100%)",
  "linear-gradient(135deg, #10B981 0%, #3B82F6 100%)",
  "linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%)",
  "linear-gradient(135deg, #0EA5E9 0%, #6366F1 100%)",
  "linear-gradient(135deg, #F97316 0%, #DB2777 100%)",
  "linear-gradient(135deg, #14B8A6 0%, #4F46E5 100%)",
]

function canUseLocalStorage(): boolean {
  if (!import.meta.client) return false
  if (typeof window === "undefined") return false
  return typeof window.localStorage !== "undefined"
}

function readIndex(): TripHistoryEntry[] {
  if (!canUseLocalStorage()) return []
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as TripHistoryEntry[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry) =>
        entry &&
        typeof entry.sessionId === "string" &&
        entry.sessionId.length > 0 &&
        typeof entry.title === "string" &&
        typeof entry.destination === "string" &&
        typeof entry.updatedAt === "string",
    )
  } catch {
    window.localStorage.removeItem(STORAGE_KEY)
    return []
  }
}

function writeIndex(entries: TripHistoryEntry[]): void {
  if (!canUseLocalStorage()) return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
}

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

export function coverForDestination(destination: string): string {
  if (!destination) return COVER_PALETTES[0]
  const index = hashString(destination) % COVER_PALETTES.length
  return COVER_PALETTES[index]
}

function entryFromSession(session: SessionState): TripHistoryEntry | null {
  if (!session?.id) return null
  const plan: Plan | null = session.currentPlan ?? null
  const brief = session.brief
  const destination = brief?.destination || plan?.destination || ""
  const title =
    session.title ||
    plan?.title ||
    (destination ? `${destination} 旅行方案` : "未命名行程")

  const dailyPlans = plan?.dailyPlans
  const days = dailyPlans?.length ?? plan?.days ?? brief?.days ?? 0
  const cities = new Set<string>()
  dailyPlans?.forEach((day) => {
    if (day.city) cities.add(day.city)
  })
  if (destination) cities.add(destination)

  let poiCount = 0
  if (Array.isArray(dailyPlans)) {
    for (const day of dailyPlans) {
      if (Array.isArray(day.items)) poiCount += day.items.length
    }
  }

  return {
    sessionId: session.id,
    title,
    destination,
    days,
    poiCount,
    cityCount: Math.max(cities.size, destination ? 1 : 0),
    updatedAt: new Date(session.updatedAt ?? Date.now()).toISOString(),
  }
}

export function useTripHistory() {
  const entries = ref<TripHistoryEntry[]>([])
  const { resolveApiBase } = useApiBase()

  function loadFromLocalStorage() {
    entries.value = readIndex().sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )
  }

  async function refresh() {
    if (!import.meta.client) return
    try {
      const r = await fetch(`${resolveApiBase()}/api/sessions`, { credentials: "include" })
      if (!r.ok) {
        loadFromLocalStorage()
        return
      }
      const body = (await r.json()) as { sessions: SessionState[] }
      const mapped = (body.sessions || [])
        .map(entryFromSession)
        .filter((entry): entry is TripHistoryEntry => entry !== null)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      entries.value = mapped.slice(0, MAX_ENTRIES)
    } catch {
      loadFromLocalStorage()
    }
  }

  function upsert(entry: TripHistoryEntry) {
    const list = readIndex()
    const existingIndex = list.findIndex((item) => item.sessionId === entry.sessionId)
    if (existingIndex >= 0) {
      list.splice(existingIndex, 1, entry)
    } else {
      list.push(entry)
    }
    list.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    writeIndex(list)
    entries.value = list.slice(0, MAX_ENTRIES)
  }

  function remove(sessionId: string) {
    const list = readIndex().filter((item) => item.sessionId !== sessionId)
    writeIndex(list)
    entries.value = list
  }

  function clear() {
    if (!canUseLocalStorage()) return
    window.localStorage.removeItem(STORAGE_KEY)
    entries.value = []
  }

  if (import.meta.client) {
    refresh()
  }

  return {
    entries,
    refresh,
    upsert,
    remove,
    clear,
    coverForDestination,
  }
}
