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

DROP TABLE IF EXISTS trip_sessions;
