import { execFile } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { promisify } from 'util'
import type { SkillManifest, SkillHandler } from './types.js'

const execFileAsync = promisify(execFile)

export function getSkillTimeoutMs(): number {
  const raw = process.env.SKILL_EXEC_TIMEOUT_MS
  if (!raw) return 60000
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 60000
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const result: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/)
    if (kv) result[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '')
  }
  // extract nested metadata.version: look for version under metadata block
  const versionMatch = match[1].match(/metadata:\s*\n\s+version:\s*([^\n]+)/)
  if (versionMatch) result['version'] = versionMatch[1].trim()
  return result
}

function camelToKebab(str: string): string {
  return str.replace(/([A-Z])/g, '-$1').toLowerCase()
}

function buildCliArgs(skillName: string, args: Record<string, unknown>): [string, string[]] {
  const { command, ...rest } = args
  const subcommand = typeof command === 'string' ? command : 'ai-search'
  const flags: string[] = []
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined && value !== null) {
      flags.push(`--${camelToKebab(key)}`, String(value))
    }
  }
  return [skillName, [subcommand, ...flags]]
}

export function loadSkillFromDir(
  dirPath: string,
): { manifest: SkillManifest; handler: SkillHandler } | null {
  const skillMdPath = dirPath.replace(/^~/, process.env.HOME ?? '') + '/SKILL.md'
  if (!existsSync(skillMdPath)) {
    console.warn(`[DirSkillLoader] SKILL.md not found: ${skillMdPath}`)
    return null
  }

  let meta: Record<string, string>
  try {
    const content = readFileSync(skillMdPath, 'utf-8')
    meta = parseFrontmatter(content)
  } catch (err) {
    console.warn(`[DirSkillLoader] Failed to parse ${skillMdPath}:`, err)
    return null
  }

  const name = meta['name']
  const version = meta['version'] ?? '0.0.0'
  const description = meta['description'] ?? ''

  if (!name) {
    console.warn(`[DirSkillLoader] Missing name in frontmatter: ${skillMdPath}`)
    return null
  }

  let parameters: SkillManifest['parameters'] | undefined
  const parametersPath = dirPath.replace(/^~/, process.env.HOME ?? '') + '/parameters.json'
  if (existsSync(parametersPath)) {
    try {
      parameters = JSON.parse(readFileSync(parametersPath, 'utf-8')) as SkillManifest['parameters']
    } catch (err) {
      console.warn(`[DirSkillLoader] Failed to parse ${parametersPath}:`, err)
    }
  }

  const manifest: SkillManifest = { name, version, description, ...(parameters ? { parameters } : {}) }

  const handler: SkillHandler = async (args) => {
    const [bin, cliArgs] = buildCliArgs(name, args)
    try {
      const { stdout } = await execFileAsync(bin, cliArgs, { timeout: getSkillTimeoutMs() })
      return stdout.trim()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Skill "${name}" CLI error: ${msg}`)
    }
  }

  return { manifest, handler }
}
