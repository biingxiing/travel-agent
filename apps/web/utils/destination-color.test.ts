import { describe, it, expect } from 'vitest'
import { destinationColor } from './destination-color'

describe('destinationColor', () => {
  it('returns the Japan gradient for 京都', () => {
    expect(destinationColor('京都')).toMatch(/F9A8D4/)
  })
  it('returns the same Japan gradient for 东京 / 大阪 / 奈良', () => {
    const kyoto = destinationColor('京都')
    expect(destinationColor('东京')).toBe(kyoto)
    expect(destinationColor('大阪')).toBe(kyoto)
    expect(destinationColor('奈良')).toBe(kyoto)
  })
  it('returns the North-China gradient for 北京 / 西安 / 敦煌', () => {
    const bj = destinationColor('北京')
    expect(bj).toMatch(/FCD34D/)
    expect(destinationColor('西安')).toBe(bj)
    expect(destinationColor('敦煌')).toBe(bj)
  })
  it('returns the Hokkaido gradient for 北海道 / 札幌', () => {
    const hk = destinationColor('北海道')
    expect(hk).toMatch(/86EFAC/)
    expect(destinationColor('札幌')).toBe(hk)
  })
  it('returns the Jiangnan gradient for 杭州 / 苏州 / 上海', () => {
    const hz = destinationColor('杭州')
    expect(hz).toMatch(/C7D2FE/)
    expect(destinationColor('苏州')).toBe(hz)
    expect(destinationColor('上海')).toBe(hz)
  })
  it('returns the Europe gradient for 巴黎 / 伦敦 / 阿姆斯特丹', () => {
    const paris = destinationColor('巴黎')
    expect(paris).toMatch(/DDD6FE/)
    expect(destinationColor('伦敦')).toBe(paris)
    expect(destinationColor('阿姆斯特丹')).toBe(paris)
  })
  it('returns the SEA gradient for 清迈 / 曼谷 / 巴厘岛', () => {
    const cm = destinationColor('清迈')
    expect(cm).toMatch(/FDBA74/)
    expect(destinationColor('曼谷')).toBe(cm)
    expect(destinationColor('巴厘岛')).toBe(cm)
  })
  it('falls back to the brand gradient for unknown destinations', () => {
    expect(destinationColor('火星')).toMatch(/7B5BFF/)
    expect(destinationColor('')).toMatch(/7B5BFF/)
    expect(destinationColor(undefined)).toMatch(/7B5BFF/)
  })
})
