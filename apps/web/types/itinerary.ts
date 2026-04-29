export type Role = "assistant" | "user" | "system" | "narration"

export interface ChatMessage {
  id: string
  role: Role
  content: string
}
