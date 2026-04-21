import { z } from 'zod'

export const MessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.number(),
})

export const ChatRequestSchema = z.object({
  sessionId: z.string().optional(),
  message: z.string(),
})

export type Message = z.infer<typeof MessageSchema>
export type ChatRequest = z.infer<typeof ChatRequestSchema>
