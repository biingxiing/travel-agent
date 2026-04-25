CREATE TABLE IF NOT EXISTS sessions (
  id              uuid PRIMARY KEY,
  user_id         text NOT NULL,
  title           text,
  brief           jsonb,
  messages        jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_plan    jsonb,
  current_score   jsonb,
  status          text NOT NULL DEFAULT 'draft',
  iteration_count int  NOT NULL DEFAULT 0,
  last_run_id     text,
  pending_clarification text,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_user_updated_idx
  ON sessions (user_id, updated_at DESC);

-- Drop legacy multi-version / collab / memory tables (CASCADE handles FKs)
DROP TABLE IF EXISTS trip_invites CASCADE;
DROP TABLE IF EXISTS trip_collaborators CASCADE;
DROP TABLE IF EXISTS guide_snippets CASCADE;
DROP TABLE IF EXISTS tool_snapshots CASCADE;
DROP TABLE IF EXISTS decision_logs CASCADE;
DROP TABLE IF EXISTS plan_versions CASCADE;
DROP TABLE IF EXISTS trip_brief_revisions CASCADE;
DROP TABLE IF EXISTS trip_sessions CASCADE;
DROP TABLE IF EXISTS user_profiles CASCADE;
DROP TABLE IF EXISTS poi_canonical CASCADE;

CREATE TABLE IF NOT EXISTS llm_calls (
  id                uuid        PRIMARY KEY,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  session_id        uuid,
  run_id            text,
  agent             text        NOT NULL,
  model             text        NOT NULL,
  stream            boolean     NOT NULL DEFAULT false,
  request           jsonb       NOT NULL,
  response          jsonb,
  prompt_tokens     integer,
  completion_tokens integer,
  total_tokens      integer,
  latency_ms        integer     NOT NULL,
  ok                boolean     NOT NULL,
  error_message     text,
  error_code        text
);

CREATE INDEX IF NOT EXISTS llm_calls_session_idx ON llm_calls (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS llm_calls_created_idx ON llm_calls (created_at DESC);
CREATE INDEX IF NOT EXISTS llm_calls_agent_idx   ON llm_calls (agent, created_at DESC);
