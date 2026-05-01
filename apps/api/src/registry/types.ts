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
