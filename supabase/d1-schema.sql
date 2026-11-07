-- Cloudflare D1 (SQLite) schema for GTNH Factory Flow accounts, library, and community.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS community_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE CHECK (length(username) BETWEEN 3 AND 24),
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'))
);

CREATE TABLE IF NOT EXISTS community_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  game_version TEXT NOT NULL DEFAULT '',
  dataset_version TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL,
  thumbnail_data_url TEXT,
  needs TEXT NOT NULL DEFAULT '[]',
  outputs TEXT NOT NULL DEFAULT '[]',
  total_eu_t REAL NOT NULL DEFAULT 0,
  machine_count INTEGER NOT NULL DEFAULT 0,
  node_count INTEGER NOT NULL DEFAULT 0,
  storage_count INTEGER NOT NULL DEFAULT 0,
  edge_count INTEGER NOT NULL DEFAULT 0,
  highest_tier TEXT,
  highest_tier_index INTEGER NOT NULL DEFAULT -1,
  upvotes INTEGER NOT NULL DEFAULT 0,
  downvotes INTEGER NOT NULL DEFAULT 0,
  score INTEGER GENERATED ALWAYS AS (upvotes - downvotes) STORED,
  downloads INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  uploader_key TEXT NOT NULL,
  user_id TEXT REFERENCES community_users (id) ON DELETE CASCADE,
  author_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  tags TEXT NOT NULL DEFAULT '[]',
  tags_text TEXT NOT NULL DEFAULT '',
  is_public INTEGER NOT NULL DEFAULT 1,
  icon TEXT,
  stats_version TEXT NOT NULL DEFAULT '',
  comment_count INTEGER NOT NULL DEFAULT 0,
  last_comment_at TEXT,
  last_activity_at TEXT
);

CREATE INDEX IF NOT EXISTS community_plans_user_idx ON community_plans (user_id);
CREATE INDEX IF NOT EXISTS community_plans_created_at_idx ON community_plans (created_at DESC);
CREATE INDEX IF NOT EXISTS community_plans_score_idx ON community_plans (score DESC);
CREATE INDEX IF NOT EXISTS community_plans_downloads_idx ON community_plans (downloads DESC);
CREATE INDEX IF NOT EXISTS community_plans_views_idx ON community_plans (views DESC);
CREATE INDEX IF NOT EXISTS community_plans_machine_count_idx ON community_plans (machine_count DESC);
CREATE INDEX IF NOT EXISTS community_plans_node_count_idx ON community_plans (node_count DESC);
CREATE INDEX IF NOT EXISTS community_plans_tier_idx ON community_plans (highest_tier_index);
CREATE INDEX IF NOT EXISTS community_plans_public_idx ON community_plans (is_public, created_at DESC);
CREATE INDEX IF NOT EXISTS community_plans_activity_idx ON community_plans (last_activity_at DESC);
CREATE INDEX IF NOT EXISTS community_plans_comments_idx ON community_plans (comment_count DESC);

CREATE TABLE IF NOT EXISTS community_votes (
  plan_id TEXT NOT NULL REFERENCES community_plans (id) ON DELETE CASCADE,
  voter_key TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  user_id TEXT REFERENCES community_users (id) ON DELETE CASCADE,
  PRIMARY KEY (plan_id, voter_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS community_votes_one_per_account
  ON community_votes (plan_id, user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS community_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_key TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'))
);

CREATE INDEX IF NOT EXISTS community_events_window_idx
  ON community_events (actor_key, action, created_at DESC);

CREATE TABLE IF NOT EXISTS blueprints (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES community_users (id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  payload TEXT NOT NULL,
  node_count INTEGER NOT NULL DEFAULT 0,
  storage_count INTEGER NOT NULL DEFAULT 0,
  edge_count INTEGER NOT NULL DEFAULT 0,
  pocket_count INTEGER NOT NULL DEFAULT 0,
  machine_count INTEGER NOT NULL DEFAULT 0,
  is_public INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  author_name TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  needs TEXT NOT NULL DEFAULT '[]',
  outputs TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  tags_text TEXT NOT NULL DEFAULT '',
  upvotes INTEGER NOT NULL DEFAULT 0,
  downvotes INTEGER NOT NULL DEFAULT 0,
  score INTEGER GENERATED ALWAYS AS (upvotes - downvotes) STORED,
  downloads INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  icon TEXT,
  highest_tier TEXT,
  highest_tier_index INTEGER NOT NULL DEFAULT -1
);

CREATE INDEX IF NOT EXISTS blueprints_user_created_idx ON blueprints (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS blueprints_public_new_idx ON blueprints (is_public, published_at DESC);
CREATE INDEX IF NOT EXISTS blueprints_public_top_idx ON blueprints (is_public, score DESC);
CREATE INDEX IF NOT EXISTS blueprints_public_downloads_idx ON blueprints (is_public, downloads DESC);

CREATE TABLE IF NOT EXISTS blueprint_votes (
  blueprint_id TEXT NOT NULL REFERENCES blueprints (id) ON DELETE CASCADE,
  voter_key TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  PRIMARY KEY (blueprint_id, voter_key)
);

CREATE TABLE IF NOT EXISTS library_folders (
  user_id TEXT NOT NULL REFERENCES community_users (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  deleted_at TEXT,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS library_designs (
  user_id TEXT NOT NULL REFERENCES community_users (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  plan TEXT NOT NULL,
  icon TEXT,
  folder_id TEXT,
  closed INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER,
  community_plan_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  plan_updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  deleted_at TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL DEFAULT 0,
  live_lease_until TEXT,
  live_lease_token TEXT,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS library_designs_user_updated_idx
  ON library_designs (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS library_design_members (
  owner_id TEXT NOT NULL REFERENCES community_users (id) ON DELETE CASCADE,
  design_id TEXT NOT NULL,
  member_id TEXT NOT NULL REFERENCES community_users (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('editor')),
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  PRIMARY KEY (owner_id, design_id, member_id),
  FOREIGN KEY (owner_id, design_id) REFERENCES library_designs (user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS library_design_members_member ON library_design_members (member_id);

CREATE TABLE IF NOT EXISTS community_comments (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES community_plans (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES community_users (id) ON DELETE CASCADE,
  author_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS community_comments_plan_idx
  ON community_comments (plan_id, created_at);

CREATE TABLE IF NOT EXISTS local_storage_buckets (
  id TEXT PRIMARY KEY,
  public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'))
);

CREATE TABLE IF NOT EXISTS local_storage_objects (
  bucket TEXT NOT NULL REFERENCES local_storage_buckets (id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  cache_control TEXT,
  bytes BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  PRIMARY KEY (bucket, path)
);

CREATE TABLE IF NOT EXISTS d1_json_chunks (
  table_name TEXT NOT NULL,
  row_key TEXT NOT NULL,
  column_name TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  PRIMARY KEY (table_name, row_key, column_name, chunk_index)
);
