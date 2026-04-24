import { describe, it, expect } from 'vitest'
import { poiVisualForType } from './poi-visual'

describe('poiVisualForType', () => {
  it('returns the hotel gradient for lodging', () => {
    expect(poiVisualForType('lodging')).toEqual({
      gradient: 'var(--gradient-poi-hotel)',
      icon: 'bed',
    })
  })

  it('returns the food gradient for meal', () => {
    expect(poiVisualForType('meal')).toEqual({
      gradient: 'var(--gradient-poi-food)',
      icon: 'utensils-crossed',
    })
  })

  it('returns the POI gradient for attraction', () => {
    expect(poiVisualForType('attraction')).toEqual({
      gradient: 'var(--gradient-poi-poi)',
      icon: 'mountain',
    })
  })

  it('returns the transit gradient for transport', () => {
    expect(poiVisualForType('transport')).toEqual({
      gradient: 'var(--gradient-poi-transit)',
      icon: 'tram-front',
    })
  })

  it('returns POI gradient + compass for activity', () => {
    expect(poiVisualForType('activity')).toEqual({
      gradient: 'var(--gradient-poi-poi)',
      icon: 'compass',
    })
  })

  it('returns a neutral grey gradient + sticky-note for note', () => {
    const v = poiVisualForType('note')
    expect(v.icon).toBe('sticky-note')
    expect(v.gradient).toMatch(/linear-gradient/)
    expect(v.gradient).not.toMatch(/var\(--gradient-poi-/)
  })

  it('falls back to attraction for unknown types', () => {
    expect(poiVisualForType('xyz').gradient).toBe('var(--gradient-poi-poi)')
    expect(poiVisualForType('xyz').icon).toBe('mountain')
  })

  it('accepts undefined/null and returns fallback', () => {
    expect(poiVisualForType(undefined).icon).toBe('mountain')
    expect(poiVisualForType(null).icon).toBe('mountain')
  })
})
