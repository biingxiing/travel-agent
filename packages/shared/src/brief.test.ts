import { describe, it, expect } from 'vitest'
import { TripBriefSchema, isBriefMinimallyComplete, mergeBrief } from './brief.js'

describe('TripBrief', () => {
  it('parses minimal brief', () => {
    const b = TripBriefSchema.parse({ destination: '北京', days: 3 })
    expect(b.travelers).toBe(1)
    expect(b.preferences).toEqual([])
  })

  it('isBriefMinimallyComplete requires destination + days', () => {
    expect(isBriefMinimallyComplete({ destination: '', days: 0 })).toBe(false)
    expect(isBriefMinimallyComplete({ destination: '北京', days: 0 })).toBe(false)
    expect(isBriefMinimallyComplete({ destination: '北京', days: 3 })).toBe(true)
  })

  it('mergeBrief overlays new fields, keeps old non-overwritten', () => {
    const a = TripBriefSchema.parse({ destination: '北京', days: 3, originCity: '上海' })
    const b = mergeBrief(a, { days: 5 })
    expect(b.destination).toBe('北京')
    expect(b.originCity).toBe('上海')
    expect(b.days).toBe(5)
  })
})
