import { describe, it, expect } from 'vitest'
import { motionPresets } from './useMotion'

describe('motionPresets', () => {
  it('exposes five named presets', () => {
    expect(Object.keys(motionPresets).sort()).toEqual([
      'fadeIn', 'ghostPulse', 'listStagger', 'pop', 'slideUp',
    ])
  })

  it('fadeIn lasts 240ms', () => {
    expect(motionPresets.fadeIn.transition?.duration).toBe(0.24)
  })

  it('slideUp moves from y:8 to y:0', () => {
    expect(motionPresets.slideUp.initial).toMatchObject({ y: 8, opacity: 0 })
    expect(motionPresets.slideUp.animate).toMatchObject({ y: 0, opacity: 1 })
  })

  it('pop scales from 0.96 to 1', () => {
    expect(motionPresets.pop.initial).toMatchObject({ scale: 0.96, opacity: 0 })
    expect(motionPresets.pop.animate).toMatchObject({ scale: 1, opacity: 1 })
  })

  it('listStagger declares a 40ms child delay', () => {
    expect(motionPresets.listStagger.staggerChildren).toBe(0.04)
  })

  it('ghostPulse loops indefinitely at 1.6s', () => {
    expect(motionPresets.ghostPulse.transition?.duration).toBe(1.6)
    expect(motionPresets.ghostPulse.transition?.repeat).toBe(Infinity)
  })
})
