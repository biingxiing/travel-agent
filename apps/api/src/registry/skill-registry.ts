import type { Skill, SkillManifest, SkillHandler } from './types.js'

const skills = new Map<string, Skill>()

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
    return skill.handler(args)
  },
}
