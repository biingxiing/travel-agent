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
    destinations: brief.destinations,
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

function offsetDate(startStr: string, n: number): string {
  const d = new Date(startStr)
  d.setDate(d.getDate() + n)
  return formatDate(d)
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

function isRateLimitError(msg: string): boolean {
  return /\b429\b|rate[ _-]?limit/i.test(msg)
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
    if (isRateLimitError(msg)) {
      console.warn(`[Prefetch] flyai ${args.command} hit 429, retrying after 3s`)
      await new Promise((r) => setTimeout(r, 3000))
      try {
        const out = await skillRegistry.invoke(FLYAI_NAME, args)
        return `真实${label}数据 (flyai ${args.command} args=${JSON.stringify(args)}):\n${truncate(out, MAX_ENTRY_BODY_CHARS)}`
      } catch (err2) {
        const msg2 = err2 instanceof Error ? err2.message : String(err2)
        console.warn(`[Prefetch] flyai ${args.command} failed after retry, skipping: ${msg2}`)
        return null
      }
    }
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
  const totalDays = brief.days || 3
  const cities = brief.destinations
  const origin = brief.originCity ?? null

  const tasks: Array<Promise<string | null>> = []

  // Build transport legs
  const legs: Array<{ from: string; to: string; depOffset: number }> = []
  if (origin && cities.length > 0) {
    legs.push({ from: origin, to: cities[0], depOffset: 0 })
  }
  for (let i = 0; i < cities.length - 1; i++) {
    const offset = Math.round(totalDays * (i + 1) / cities.length)
    legs.push({ from: cities[i], to: cities[i + 1], depOffset: offset })
  }
  if (origin && cities.length > 0) {
    legs.push({ from: cities[cities.length - 1], to: origin, depOffset: totalDays - 1 })
  }

  // Flight + train for each leg
  for (const leg of legs) {
    const depDate = offsetDate(dates.start, leg.depOffset)
    tasks.push(tryInvoke({ command: 'search-flight', origin: leg.from, destination: leg.to, depDate }, '航班'))
    tasks.push(tryInvoke({ command: 'search-train',  origin: leg.from, destination: leg.to, depDate }, '火车'))
  }

  // Hotel + POI for each destination city
  for (const city of cities) {
    tasks.push(tryInvoke({ command: 'search-hotel', destName: city, checkInDate: dates.start, checkOutDate: dates.end }, '酒店'))
    tasks.push(tryInvoke({ command: 'search-poi',   cityName: city }, '景点'))
  }

  const results = await Promise.all(tasks)
  const ctx = results.filter((r): r is string => r !== null)
  cache.set(key, ctx)
  console.log(`[Prefetch] gathered ${ctx.length}/${tasks.length} entries for session=${sessionId} cities=${cities.join(',')}/${totalDays}d`)
  return ctx
}
