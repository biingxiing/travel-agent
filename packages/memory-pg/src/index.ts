import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const travelMemoryPgMigrationFile = join(__dirname, "../travel-memory-pg.sql")
export const travelMemoryPgMigrationSql = readFileSync(travelMemoryPgMigrationFile, "utf8")
