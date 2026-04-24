import { randomUUID } from 'crypto'
import { SessionStateSchema, type SessionState, type Message } from '@travel-agent/shared'
import {
  isDatabaseEnabled, loadSession, listSessionsForUser, upsertSession, deleteSession,
} from '../persistence/pg.js'

const memory = new Map<string, SessionState>()

function nowMs() { return Date.now() }

async function persist(state: SessionState): Promise<void> {
  memory.set(state.id, state)
  if (isDatabaseEnabled()) {
    try { await upsertSession(state) }
    catch (err) { console.error('[sessionStore] DB upsert failed:', err) }
  }
}

async function fetch(id: string): Promise<SessionState | null> {
  const cached = memory.get(id)
  if (cached) return cached
  if (!isDatabaseEnabled()) return null
  try {
    const loaded = await loadSession(id)
    if (loaded) memory.set(loaded.id, loaded)
    return loaded
  } catch (err) {
    console.error('[sessionStore] DB load failed:', err)
    return null
  }
}

export const sessionStore = {
  async create(userId: string): Promise<SessionState> {
    const state = SessionStateSchema.parse({
      id: randomUUID(), userId, status: 'draft',
      iterationCount: 0, createdAt: nowMs(), updatedAt: nowMs(),
    })
    await persist(state)
    return state
  },

  async get(id: string, userId: string): Promise<SessionState | null> {
    const s = await fetch(id)
    if (!s || s.userId !== userId) return null
    return s
  },

  async appendMessage(id: string, message: Message): Promise<SessionState | null> {
    const s = memory.get(id) ?? await fetch(id)
    if (!s) return null
    s.messages.push(message)
    s.updatedAt = nowMs()
    await persist(s)
    return s
  },

  async save(state: SessionState): Promise<void> {
    state.updatedAt = nowMs()
    await persist(state)
  },

  async listByUser(userId: string, limit = 50): Promise<SessionState[]> {
    if (isDatabaseEnabled()) {
      try { return await listSessionsForUser(userId, limit) }
      catch (err) { console.error('[sessionStore] DB list failed:', err) }
    }
    return Array.from(memory.values())
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const s = await fetch(id)
    if (!s || s.userId !== userId) return false
    memory.delete(id)
    if (isDatabaseEnabled()) {
      try { return await deleteSession(id, userId) }
      catch (err) { console.error('[sessionStore] DB delete failed:', err); return true }
    }
    return true
  },

  async updateRunId(id: string): Promise<string | null> {
    const s = memory.get(id) ?? await fetch(id)
    if (!s) return null
    s.lastRunId = randomUUID()
    s.updatedAt = nowMs()
    await persist(s)
    return s.lastRunId
  },
}
