import type { SessionState, Plan } from "@travel-agent/shared"
import { useApiBase } from "./useApiBase"
import { destinationColor } from "~/utils/destination-color"

export interface TripHistoryEntry {
  sessionId: string
  title: string
  destination: string
  days: number
  poiCount: number
  cityCount: number
  updatedAt: string
  status?: 'planning' | 'completed'
}

const STORAGE_KEY = "travel-agent.trips.index"
const MAX_ENTRIES = 24

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

export const coverForDestination = destinationColor

const IN_PROGRESS_STATUSES = new Set(['planning', 'refining', 'awaiting_user'])

export function entryFromSession(session: SessionState): TripHistoryEntry | null {
  if (!session?.id) return null
  const plan: Plan | null = session.currentPlan ?? null
  const brief = session.brief
  const hasRecoverableBrief = Array.isArray(brief?.destinations) && brief.destinations.length > 0
  const hasNamedTitle = typeof session.title === 'string' && session.title.trim().length > 0
  const isInProgress = IN_PROGRESS_STATUSES.has(session.status)

  if (!isInProgress && !plan && !hasRecoverableBrief && !hasNamedTitle) {
    return null
  }

  const dests: string[] = brief?.destinations ?? plan?.destinations ?? []
  const destination = dests.length > 1 ? dests.join(' / ') : (dests[0] ?? '')

  let title: string
  if (hasNamedTitle) {
    title = session.title!
  } else if (plan?.title) {
    title = plan.title
  } else if (destination) {
    title = `${destination} 旅行方案`
  } else if (isInProgress) {
    const firstUserMsg = session.messages?.find((m) => m.role === 'user')?.content ?? ''
    title = firstUserMsg.length > 30 ? firstUserMsg.slice(0, 40) + '…' : (firstUserMsg || '规划中…')
  } else {
    title = '未命名行程'
  }

  const dailyPlans = plan?.dailyPlans
  const days = dailyPlans?.length ?? plan?.days ?? brief?.days ?? 0
  const cities = new Set<string>()
  dailyPlans?.forEach((day) => { if (day.city) cities.add(day.city) })
  ;(brief?.destinations ?? plan?.destinations ?? []).forEach((d) => { if (d) cities.add(d) })

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
    status: isInProgress ? 'planning' : 'completed',
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
