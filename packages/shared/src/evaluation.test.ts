import { describe, it, expect } from 'vitest'
import { CriticReportSchema, BlockerTypeEnum } from './evaluation.js'

describe('CriticReport', () => {
  it('parses a complete critic report', () => {
    const r = CriticReportSchema.parse({
      qualityScore: 75,
      blockers: [{ type: 'missing_origin', message: '请告诉我从哪里出发' }],
      itemIssues: [{
        dayNum: 1, itemIndex: 0, severity: 'high', category: 'transport',
        problem: '缺少航班号', suggestedAction: 'call_flyai_flight',
      }],
      globalIssues: ['第 1 天和第 3 天景点重复'],
    })
    expect(r.blockers).toHaveLength(1)
  })

  it('rejects unknown blocker type', () => {
    expect(() => CriticReportSchema.parse({
      qualityScore: 75, blockers: [{ type: 'unknown', message: 'x' }],
      itemIssues: [], globalIssues: [],
    })).toThrow()
  })

  it('coerces missing arrays to []', () => {
    const r = CriticReportSchema.parse({ qualityScore: 0 })
    expect(r.blockers).toEqual([])
    expect(r.itemIssues).toEqual([])
    expect(r.globalIssues).toEqual([])
  })
})
