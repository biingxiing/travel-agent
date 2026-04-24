import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const KEYS = ['EVAL_RULE_WEIGHT','EVAL_THRESHOLD','EVAL_MAX_ITER','EVAL_REQUIRED_CATEGORIES']

describe('eval config', () => {
  let saved: Record<string, string|undefined> = {}
  beforeEach(() => { for (const k of KEYS) saved[k] = process.env[k] })
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('defaults', async () => {
    for (const k of KEYS) delete process.env[k]
    const cfg = await import('./eval.js?t=' + Date.now()).then((m) => (m as any).getEvalConfig())
    expect(cfg.ruleWeight).toBe(0.7)
    expect(cfg.threshold).toBe(90)
    expect(cfg.maxIter).toBe(10)
    expect(cfg.requiredCategories).toEqual(['transport','lodging','attraction'])
  })

  it('reads from env', async () => {
    process.env.EVAL_RULE_WEIGHT = '0.5'
    process.env.EVAL_THRESHOLD = '85'
    process.env.EVAL_MAX_ITER = '5'
    process.env.EVAL_REQUIRED_CATEGORIES = 'transport,attraction'
    const cfg = await import('./eval.js?t=' + Date.now()).then((m) => (m as any).getEvalConfig())
    expect(cfg.ruleWeight).toBe(0.5)
    expect(cfg.threshold).toBe(85)
    expect(cfg.maxIter).toBe(5)
    expect(cfg.requiredCategories).toEqual(['transport','attraction'])
  })

  it('clamps ruleWeight to [0,1]', async () => {
    process.env.EVAL_RULE_WEIGHT = '1.5'
    const cfg = await import('./eval.js?t=' + Date.now()).then((m) => (m as any).getEvalConfig())
    expect(cfg.ruleWeight).toBe(1)
  })
})
