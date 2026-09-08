-- WeatherNext 3 Bot tables for Cloudflare D1
-- Run via: wrangler d1 execute wn3-db --file=./wn3/migration.sql

CREATE TABLE IF NOT EXISTS wn3_users (
  chat_id INTEGER PRIMARY KEY,
  lang TEXT DEFAULT 'en',
  enabled INTEGER DEFAULT 1,
  alerts_enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wn3_user_settings (
  chat_id INTEGER PRIMARY KEY,
  wind_threshold INTEGER DEFAULT 40,
  rain_threshold INTEGER DEFAULT 15,
  heat_threshold INTEGER DEFAULT 35,
  cold_threshold INTEGER DEFAULT -20,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wn3_user_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  name TEXT DEFAULT 'My Location',
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (chat_id) REFERENCES wn3_users(chat_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wn3_users_enabled ON wn3_users(enabled) WHERE enabled = 1;
CREATE INDEX IF NOT EXISTS idx_wn3_locs_chat ON wn3_user_locations(chat_id);
CREATE INDEX IF NOT EXISTS idx_wn3_locs_default ON wn3_user_locations(chat_id, is_default) WHERE is_default = 1;
