import { describe, it, expect } from 'vitest'
import { sessionStore } from './store.js'

describe('sessionStore (memory)', () => {
  it('creates and reads', async () => {
    const s = await sessionStore.create('user-1')
    const got = await sessionStore.get(s.id, 'user-1')
    expect(got?.id).toBe(s.id)
    expect(got?.userId).toBe('user-1')
    expect(got?.status).toBe('draft')
  })

  it('returns null when foreign user reads', async () => {
    const s = await sessionStore.create('user-2')
    const got = await sessionStore.get(s.id, 'other')
    expect(got).toBeNull()
  })

  it('appends messages', async () => {
    const s = await sessionStore.create('user-3')
    await sessionStore.appendMessage(s.id, { role: 'user', content: 'hi', timestamp: 1 })
    const got = await sessionStore.get(s.id, 'user-3')
    expect(got?.messages).toHaveLength(1)
  })

  it('lists by user, newest first', async () => {
    const a = await sessionStore.create('user-list')
    await new Promise((r) => setTimeout(r, 5))
    const b = await sessionStore.create('user-list')
    const list = await sessionStore.listByUser('user-list')
    expect(list[0].id).toBe(b.id)
    expect(list[1].id).toBe(a.id)
  })
})
