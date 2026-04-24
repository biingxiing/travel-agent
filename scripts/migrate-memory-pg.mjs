import { Pool } from "pg"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  console.error("Missing DATABASE_URL")
  process.exit(1)
}

const repoRoot = resolve(import.meta.dirname, "..")
const files = [
  resolve(repoRoot, "packages/memory-pg/travel-memory-pg.sql"),
  resolve(repoRoot, "packages/memory-pg/trip-collaborators.sql"),
]
const sql = files.map((file) => readFileSync(file, "utf8")).join("\n\n")

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("sslmode=require")
    ? { rejectUnauthorized: false }
    : undefined,
})

const client = await pool.connect()

try {
  await client.query(sql)
  console.log("memory-pg migration executed successfully")
} finally {
  client.release()
  await pool.end()
}
