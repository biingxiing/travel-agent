import type { Message, ChatStreamEvent } from '@travel-agent/shared'

export interface SkillManifest {
  name: string
  version: string
  description: string
  parameters?: Record<string, { type: string; description: string; required?: boolean }>
}

export interface SkillHandler {
  (args: Record<string, unknown>): Promise<string>
}

export interface Skill {
  manifest: SkillManifest
  handler: SkillHandler
}

export interface AgentManifest {
  name: string
  version: string
  description: string
  requiredSkills?: string[]
}

export interface AgentHandler {
  (messages: Message[]): AsyncGenerator<ChatStreamEvent>
}

export interface Agent {
  manifest: AgentManifest
  handler: AgentHandler
}
