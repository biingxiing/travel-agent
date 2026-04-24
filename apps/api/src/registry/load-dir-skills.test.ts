import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('skill exec timeout config', () => {
  let original: string | undefined
  beforeEach(() => { original = process.env.SKILL_EXEC_TIMEOUT_MS })
  afterEach(() => {
    if (original === undefined) delete process.env.SKILL_EXEC_TIMEOUT_MS
    else process.env.SKILL_EXEC_TIMEOUT_MS = original
  })

  it('reads default 60000 when env unset', async () => {
    delete process.env.SKILL_EXEC_TIMEOUT_MS
    const mod = await import('./load-dir-skills.js?t=' + Date.now())
    expect((mod as any).getSkillTimeoutMs()).toBe(60000)
  })

  it('reads value from env', async () => {
    process.env.SKILL_EXEC_TIMEOUT_MS = '120000'
    const mod = await import('./load-dir-skills.js?t=' + Date.now())
    expect((mod as any).getSkillTimeoutMs()).toBe(120000)
  })
})
