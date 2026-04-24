import { createHash } from 'crypto'
import { skillRegistry } from '../registry/skill-registry.js'
import type { TripBrief } from '@travel-agent/shared'

const MAX_ENTRY_BODY_CHARS = 3000
const FLYAI_NAME = 'flyai'

// In-memory cache keyed by `${sessionId}:${briefHash}`. Avoids re-prefetching
// the same brief across refine rounds (same session keeps issuing identical
// briefs once it stabilizes).
const cache = new Map<string, string[]>()

export function __resetPrefetchCache(): void {
  cache.clear()
}

function hashBrief(brief: TripBrief): string {
  // Only hash fields that influence the prefetch calls.
  const subset = {
    destination: brief.destination,
    days: brief.days,
    originCity: brief.originCity ?? null,
    travelers: brief.travelers ?? null,
    travelDates: brief.travelDates ?? null,
  }
  return createHash('sha1').update(JSON.stringify(subset)).digest('hex').slice(0, 12)
}

function pad(n: number): string { return n < 10 ? `0${n}` : `${n}` }

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function defaultDateRange(days: number): { start: string; end: string } {
  const start = new Date()
  start.setDate(start.getDate() + 7)
  const end = new Date(start)
  end.setDate(end.getDate() + Math.max(1, days))
  return { start: formatDate(start), end: formatDate(end) }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…(已截断 ${text.length - max} 字符)`
}

async function tryInvoke(
  args: Record<string, unknown>,
  label: string,
): Promise<string | null> {
  try {
    const out = await skillRegistry.invoke(FLYAI_NAME, args)
    return `真实${label}数据 (flyai ${args.command} args=${JSON.stringify(args)}):\n${truncate(out, MAX_ENTRY_BODY_CHARS)}`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[Prefetch] flyai ${args.command} failed, skipping: ${msg}`)
    return null
  }
}

export async function prefetchFlyaiContext(
  brief: TripBrief,
  sessionId: string,
): Promise<string[]> {
  // Cache check
  const key = `${sessionId}:${hashBrief(brief)}`
  const cached = cache.get(key)
  if (cached) {
    console.log(`[Prefetch] cache hit for ${key} (${cached.length} entries)`)
    return cached
  }

  const dates = brief.travelDates ?? defaultDateRange(brief.days || 3)

  const tasks: Array<Promise<string | null>> = []

  if (brief.originCity && brief.destination) {
    tasks.push(tryInvoke({
      command: 'search-flight',
      origin: brief.originCity,
      destination: brief.destination,
      depDate: dates.start,
    }, '航班'))
  }

  if (brief.destination) {
    tasks.push(tryInvoke({
      command: 'search-hotel',
      destName: brief.destination,
      checkInDate: dates.start,
      checkOutDate: dates.end,
    }, '酒店'))
  }

  if (brief.destination) {
    tasks.push(tryInvoke({
      command: 'search-poi',
      destName: brief.destination,
    }, '景点'))
  }

  const results = await Promise.all(tasks)
  const ctx = results.filter((r): r is string => r !== null)
  cache.set(key, ctx)
  console.log(`[Prefetch] gathered ${ctx.length}/${tasks.length} entries for session=${sessionId} brief=${brief.destination}/${brief.days}d`)
  return ctx
}
