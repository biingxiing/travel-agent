import { randomUUID } from 'crypto'
import type { Message } from '@travel-agent/shared'

export interface Session {
  id: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

const sessions = new Map<string, Session>()

export function createSession(): Session {
  const session: Session = {
    id: randomUUID(),
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  sessions.set(session.id, session)
  return session
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id)
}

export function addMessage(sessionId: string, message: Message): void {
  const session = sessions.get(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)
  session.messages.push(message)
  session.updatedAt = Date.now()
}

export function getOrCreateSession(id?: string): Session {
  if (id) {
    const existing = sessions.get(id)
    if (existing) return existing
  }
  return createSession()
}
