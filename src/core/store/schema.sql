-- minimi store schema. All statements are IF NOT EXISTS; run with db.exec at boot.
-- The FTS5 table is NOT here: it is created in code only when FTS5 is available.

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS turns (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  tz TEXT NOT NULL,
  local_date TEXT NOT NULL,
  origin TEXT NOT NULL,
  topic TEXT,
  entities_json TEXT NOT NULL,
  summary TEXT,
  extraction TEXT NOT NULL,
  intent TEXT,
  target_turn_ids_json TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS turns_session_seq ON turns (session_id, seq);
CREATE INDEX IF NOT EXISTS turns_local_date ON turns (local_date);

CREATE TABLE IF NOT EXISTS sources (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  final_url TEXT NOT NULL,
  title TEXT,
  published_at TEXT,
  fetched_at_utc TEXT NOT NULL,
  live INTEGER NOT NULL,
  first_party INTEGER NOT NULL,
  http_status INTEGER,
  text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  turn_id TEXT NOT NULL REFERENCES turns(id),
  entity TEXT NOT NULL,
  attribute TEXT NOT NULL,
  value TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources(id),
  quote TEXT NOT NULL,
  as_of_utc TEXT NOT NULL,
  volatility TEXT NOT NULL,
  last_verified_at_utc TEXT NOT NULL,
  supersedes_id TEXT REFERENCES claims(id)
);

CREATE INDEX IF NOT EXISTS claims_turn_id ON claims (turn_id);
CREATE INDEX IF NOT EXISTS claims_supersedes_id ON claims (supersedes_id);

-- Which source rows the seed script wrote, so a re-run can find them again.
-- Sources have no turn link of their own, hence the side table.
CREATE TABLE IF NOT EXISTS seed_sources (
  source_id TEXT PRIMARY KEY REFERENCES sources(id)
);

CREATE TABLE IF NOT EXISTS checks (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  claim_id TEXT NOT NULL REFERENCES claims(id),
  checked_at_utc TEXT NOT NULL,
  verdict TEXT NOT NULL,
  new_value TEXT,
  new_source_id TEXT,
  new_quote TEXT,
  reason TEXT NOT NULL,
  decided_by TEXT NOT NULL
);
