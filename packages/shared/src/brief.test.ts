import { describe, it, expect } from 'vitest'
import { TripBriefSchema } from './brief.js'

describe('TripBrief', () => {
  it('parses minimal brief', () => {
    const b = TripBriefSchema.parse({ destinations: ['北京'], days: 3 })
    expect(b.travelers).toBe(1)
    expect(b.preferences).toEqual([])
  })

  it('migrates legacy destination string to destinations array', () => {
    const b = TripBriefSchema.parse({ destination: '北京', days: 3 })
    expect(b.destinations).toEqual(['北京'])
    expect((b as any).destination).toBeUndefined()
  })

  it('coerces pace: null to undefined', () => {
    const b = TripBriefSchema.parse({ destinations: ['北京'], days: 3, pace: null })
    expect(b.pace).toBeUndefined()
  })

  it('accepts budget with null amount', () => {
    const b = TripBriefSchema.parse({
      destinations: ['北京'],
      days: 3,
      budget: { amount: null, currency: 'CNY' },
    })
    expect(b.budget?.amount).toBeUndefined()
    expect(b.budget?.currency).toBe('CNY')
  })

  it('preserves budget amount when provided', () => {
    const b = TripBriefSchema.parse({
      destinations: ['北京'],
      days: 3,
      budget: { amount: 5000, currency: 'CNY' },
    })
    expect(b.budget?.amount).toBe(5000)
    expect(b.budget?.currency).toBe('CNY')
  })

  it('coerces originCity: null to undefined', () => {
    const b = TripBriefSchema.parse({ destinations: ['北京'], days: 3, originCity: null })
    expect(b.originCity).toBeUndefined()
  })

  it('accepts properly-formatted travelDates', () => {
    const b = TripBriefSchema.parse({
      destinations: ['北京'],
      days: 8,
      travelDates: { start: '2026-05-02', end: '2026-05-09' },
    })
    expect(b.travelDates?.start).toBe('2026-05-02')
    expect(b.travelDates?.end).toBe('2026-05-09')
  })

  it('accepts travelDates with YYYY placeholder strings (post-processor handles fix)', () => {
    const b = TripBriefSchema.parse({
      destinations: ['北京'],
      days: 8,
      travelDates: { start: 'YYYY-05-02', end: 'YYYY-05-09' },
    })
    expect(b.travelDates?.start).toBe('YYYY-05-02')
    expect(b.travelDates?.end).toBe('YYYY-05-09')
  })

  it('coerces travelDates: null to undefined', () => {
    const b = TripBriefSchema.parse({ destinations: ['北京'], days: 3, travelDates: null })
    expect(b.travelDates).toBeUndefined()
  })

  it('coerces notes: null to undefined', () => {
    const b = TripBriefSchema.parse({ destinations: ['北京'], days: 3, notes: null })
    expect(b.notes).toBeUndefined()
  })
})
