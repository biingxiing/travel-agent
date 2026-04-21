import type { Agent, AgentManifest, AgentHandler } from './types.js'
import { skillRegistry } from './skill-registry.js'

const agents = new Map<string, Agent>()

export const agentRegistry = {
  register(manifest: AgentManifest, handler: AgentHandler): void {
    // Verify required skills are installed
    for (const skillName of manifest.requiredSkills ?? []) {
      if (!skillRegistry.get(skillName)) {
        throw new Error(
          `Agent "${manifest.name}" requires skill "${skillName}" which is not installed`,
        )
      }
    }
    agents.set(manifest.name, { manifest, handler })
    console.log(`[AgentRegistry] Registered agent: ${manifest.name}@${manifest.version}`)
  },

  unregister(name: string): boolean {
    const removed = agents.delete(name)
    if (removed) console.log(`[AgentRegistry] Unregistered agent: ${name}`)
    return removed
  },

  get(name: string): Agent | undefined {
    return agents.get(name)
  },

  list(): AgentManifest[] {
    return Array.from(agents.values()).map((a) => a.manifest)
  },
}
