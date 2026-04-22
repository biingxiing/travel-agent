import type { Skill, SkillManifest, SkillHandler } from './types.js'

const skills = new Map<string, Skill>()

function formatLogValue(value: unknown): string {
  const serialized = JSON.stringify(value)
  if (!serialized) return 'null'
  return serialized.length > 400 ? `${serialized.slice(0, 397)}...` : serialized
}

export const skillRegistry = {
  install(manifest: SkillManifest, handler: SkillHandler): void {
    if (skills.has(manifest.name)) {
      console.log(`[SkillRegistry] Replacing skill: ${manifest.name}`)
    }
    skills.set(manifest.name, { manifest, handler })
    console.log(`[SkillRegistry] Installed skill: ${manifest.name}@${manifest.version}`)
  },

  uninstall(name: string): boolean {
    const removed = skills.delete(name)
    if (removed) console.log(`[SkillRegistry] Uninstalled skill: ${name}`)
    return removed
  },

  get(name: string): Skill | undefined {
    return skills.get(name)
  },

  list(): SkillManifest[] {
    return Array.from(skills.values()).map((s) => s.manifest)
  },

  async invoke(name: string, args: Record<string, unknown>): Promise<string> {
    const skill = skills.get(name)
    if (!skill) throw new Error(`Skill not found: ${name}`)

    const startedAt = Date.now()
    console.log(`[SkillRegistry] Invoking skill: ${name} args=${formatLogValue(args)}`)

    try {
      const result = await skill.handler(args)
      console.log(`[SkillRegistry] Skill completed: ${name} (${Date.now() - startedAt}ms)`)
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(
        `[SkillRegistry] Skill failed: ${name} (${Date.now() - startedAt}ms) error=${message}`,
      )
      throw err
    }
  },
}
