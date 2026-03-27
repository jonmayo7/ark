// ============================================================================
// Ark — Standard Schema
// ============================================================================

/** SQL statements to create the standard agent tables (SQLite-compatible) */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agent_soul (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  directive TEXT NOT NULL,
  category TEXT,
  priority INTEGER NOT NULL DEFAULT 3,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_mind (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  content TEXT NOT NULL,
  node_type TEXT NOT NULL DEFAULT 'fact',
  domain TEXT,
  signal REAL NOT NULL DEFAULT 0.5,
  heat REAL NOT NULL DEFAULT 1.0,
  depth INTEGER NOT NULL DEFAULT 1,
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_ledger (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  entry_type TEXT NOT NULL CHECK(entry_type IN ('win', 'mistake')),
  what TEXT NOT NULL,
  why TEXT,
  should_have TEXT,
  pattern TEXT,
  severity TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_handoff (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  active_work TEXT,
  key_decisions TEXT,
  open_questions TEXT,
  next_actions TEXT,
  context_for_next TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_conversations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls TEXT,
  tool_call_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_session ON agent_conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_mind_heat ON agent_mind(heat DESC);
CREATE INDEX IF NOT EXISTS idx_mind_signal ON agent_mind(signal DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_type ON agent_ledger(entry_type);
CREATE INDEX IF NOT EXISTS idx_ledger_pattern ON agent_ledger(pattern);
`;

/** Supabase-compatible schema (Postgres) */
export const SCHEMA_POSTGRES = `
CREATE TABLE IF NOT EXISTS agent_soul (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  directive TEXT NOT NULL,
  category TEXT,
  priority INTEGER NOT NULL DEFAULT 3,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_mind (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  node_type TEXT NOT NULL DEFAULT 'fact',
  domain TEXT,
  signal REAL NOT NULL DEFAULT 0.5,
  heat REAL NOT NULL DEFAULT 1.0,
  depth INTEGER NOT NULL DEFAULT 1,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type TEXT NOT NULL CHECK(entry_type IN ('win', 'mistake')),
  what TEXT NOT NULL,
  why TEXT,
  should_have TEXT,
  pattern TEXT,
  severity TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_handoff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  active_work TEXT,
  key_decisions TEXT,
  open_questions TEXT,
  next_actions TEXT,
  context_for_next TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls JSONB,
  tool_call_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_session ON agent_conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_mind_heat ON agent_mind(heat DESC);
CREATE INDEX IF NOT EXISTS idx_mind_signal ON agent_mind(signal DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_type ON agent_ledger(entry_type);
CREATE INDEX IF NOT EXISTS idx_ledger_pattern ON agent_ledger(pattern);
`;
