import { describe, it, expect } from 'vitest'
import { TripBriefSchema, isBriefMinimallyComplete, mergeBrief } from './brief.js'

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

  it('isBriefMinimallyComplete requires destinations + days', () => {
    expect(isBriefMinimallyComplete({ destinations: [], days: 0 })).toBe(false)
    expect(isBriefMinimallyComplete({ destinations: ['北京'], days: 0 })).toBe(false)
    expect(isBriefMinimallyComplete({ destinations: ['北京'], days: 3 })).toBe(true)
  })

  it('mergeBrief overlays new fields, keeps old non-overwritten', () => {
    const a = TripBriefSchema.parse({ destinations: ['北京'], days: 3, originCity: '上海' })
    const b = mergeBrief(a, { days: 5 })
    expect(b.destinations).toEqual(['北京'])
    expect(b.originCity).toBe('上海')
    expect(b.days).toBe(5)
  })
})
