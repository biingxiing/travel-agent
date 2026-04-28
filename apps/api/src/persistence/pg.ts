import { travelMemoryPgMigrationSql } from '@travel-agent/memory-pg'
import type { SessionState } from '@travel-agent/shared'
import { SessionStateSchema } from '@travel-agent/shared'
import pg from 'pg'

const { Pool } = pg
type PgPool = InstanceType<typeof Pool>

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || ''

let pool: PgPool | null = null
let migrationPromise: Promise<void> | null = null

export function isDatabaseEnabled(): boolean {
  return Boolean(DATABASE_URL)
}

function getPool(): PgPool {
  if (!DATABASE_URL) throw new Error('DATABASE_URL is not configured')
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
    })
  }
  return pool
}

export async function runDatabaseMigrations(): Promise<void> {
  if (!isDatabaseEnabled()) return
  if (!migrationPromise) {
    migrationPromise = (async () => {
      const client = await getPool().connect()
      try { await client.query(travelMemoryPgMigrationSql) }
      finally { client.release() }
    })()
  }
  await migrationPromise
}

interface SessionRow {
  id: string
  user_id: string
  title: string | null
  brief: unknown
  messages: unknown
  current_plan: unknown
  current_score: unknown
  status: string
  iteration_count: number
  last_run_id: string | null
  pending_clarification: string | null
  created_at: Date
  updated_at: Date
}

function rowToState(row: SessionRow): SessionState {
  return SessionStateSchema.parse({
    id: row.id,
    userId: row.user_id,
    title: row.title,
    brief: row.brief ?? null,
    messages: row.messages ?? [],
    currentPlan: row.current_plan ?? null,
    currentScore: row.current_score ?? null,
    status: row.status,
    iterationCount: row.iteration_count,
    lastRunId: row.last_run_id,
    pendingClarification: row.pending_clarification,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  })
}

export async function loadSession(id: string): Promise<SessionState | null> {
  const r = await getPool().query<SessionRow>(`SELECT * FROM sessions WHERE id = $1`, [id])
  return r.rows[0] ? rowToState(r.rows[0]) : null
}

export async function listSessionsForUser(userId: string, limit = 50): Promise<SessionState[]> {
  const r = await getPool().query<SessionRow>(
    `SELECT * FROM sessions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2`,
    [userId, limit],
  )
  return r.rows.map(rowToState)
}

export async function upsertSession(state: SessionState): Promise<void> {
  await getPool().query(
    `INSERT INTO sessions (
       id, user_id, title, brief, messages, current_plan, current_score,
       status, iteration_count, last_run_id, pending_clarification,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb,
       $8, $9, $10, $11, to_timestamp($12/1000.0), to_timestamp($13/1000.0)
     )
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       brief = EXCLUDED.brief,
       messages = EXCLUDED.messages,
       current_plan = EXCLUDED.current_plan,
       current_score = EXCLUDED.current_score,
       status = EXCLUDED.status,
       iteration_count = EXCLUDED.iteration_count,
       last_run_id = EXCLUDED.last_run_id,
       pending_clarification = EXCLUDED.pending_clarification,
       updated_at = EXCLUDED.updated_at`,
    [
      state.id, state.userId, state.title,
      state.brief === null ? null : JSON.stringify(state.brief),
      JSON.stringify(state.messages),
      state.currentPlan === null ? null : JSON.stringify(state.currentPlan),
      state.currentScore === null ? null : JSON.stringify(state.currentScore),
      state.status, state.iterationCount, state.lastRunId, state.pendingClarification,
      state.createdAt, state.updatedAt,
    ],
  )
}

export async function deleteSession(id: string, userId: string): Promise<boolean> {
  const r = await getPool().query(
    `DELETE FROM sessions WHERE id = $1 AND user_id = $2`,
    [id, userId],
  )
  return (r.rowCount ?? 0) > 0
}

export interface LLMCallRow {
  id: string
  sessionId: string | null
  runId: string | null
  agent: string
  model: string
  stream: boolean
  request: unknown
  response: unknown
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  cachedTokens: number | null
  latencyMs: number
  ok: boolean
  errorMessage: string | null
  errorCode: string | null
}

export async function insertLLMCall(row: LLMCallRow): Promise<void> {
  if (!isDatabaseEnabled()) return
  await getPool().query(
    `INSERT INTO llm_calls (
       id, session_id, run_id, agent, model, stream,
       request, response,
       prompt_tokens, completion_tokens, total_tokens, cached_tokens,
       latency_ms, ok, error_message, error_code
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7::jsonb, $8::jsonb,
       $9, $10, $11, $12,
       $13, $14, $15, $16
     )`,
    [
      row.id, row.sessionId, row.runId, row.agent, row.model, row.stream,
      JSON.stringify(row.request), row.response === null ? null : JSON.stringify(row.response),
      row.promptTokens, row.completionTokens, row.totalTokens, row.cachedTokens,
      row.latencyMs, row.ok, row.errorMessage, row.errorCode,
    ],
  )
}

