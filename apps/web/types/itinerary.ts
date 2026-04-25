export type Role = "assistant" | "user" | "system"

export interface ChatMessage {
  id: string
  role: Role
  content: string
}
