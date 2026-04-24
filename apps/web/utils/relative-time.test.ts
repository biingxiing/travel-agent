import { describe, it, expect } from 'vitest'
import { relativeTime } from './relative-time'

const now = new Date('2026-04-24T12:00:00Z').getTime()

describe('relativeTime', () => {
  it('returns "刚刚" for times within 30 seconds', () => {
    expect(relativeTime(new Date(now - 5_000), now)).toBe('刚刚')
    expect(relativeTime(new Date(now - 30_000), now)).toBe('刚刚')
  })
  it('returns "N 分钟前" for minutes', () => {
    expect(relativeTime(new Date(now - 2 * 60_000), now)).toBe('2 分钟前')
    expect(relativeTime(new Date(now - 59 * 60_000), now)).toBe('59 分钟前')
  })
  it('returns "N 小时前" for hours', () => {
    expect(relativeTime(new Date(now - 3 * 3600_000), now)).toBe('3 小时前')
    expect(relativeTime(new Date(now - 23 * 3600_000), now)).toBe('23 小时前')
  })
  it('returns "N 天前" up to 7 days', () => {
    expect(relativeTime(new Date(now - 2 * 86400_000), now)).toBe('2 天前')
    expect(relativeTime(new Date(now - 7 * 86400_000), now)).toBe('7 天前')
  })
  it('returns mm-dd for anything older than 7 days', () => {
    const older = new Date('2026-04-01T12:00:00Z').getTime()
    const result = relativeTime(older, now)
    expect(result).toMatch(/^\d{2}-\d{2}$/)
  })
  it('accepts ISO strings', () => {
    expect(relativeTime('2026-04-24T11:58:00Z', now)).toBe('2 分钟前')
  })
  it('returns empty string for invalid input', () => {
    expect(relativeTime('not-a-date', now)).toBe('')
    expect(relativeTime(null, now)).toBe('')
    expect(relativeTime(undefined, now)).toBe('')
  })
})
