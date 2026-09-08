// Cloudflare D1 adapter for WN3 bot
// DB binding is injected via env in the Worker

let DB = null;

export function configureDb(env) {
  DB = env.DB || env.WN3_DB || null;
  if (!DB) {
    console.warn('[wn3/db] D1 binding not found — set DB = "wn3-db" in wrangler.toml');
  }
}

// D1 helpers
function first(row) { return row?.results?.[0] || null; }
function all(row) { return row?.results || []; }

export async function initDB() {
  if (!DB) return;
  await DB.exec(`
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
      last_weather_msg_id INTEGER DEFAULT 0,
      last_weather_chat_id INTEGER DEFAULT 0,
      last_weather_loc TEXT DEFAULT '',
      auto_update INTEGER DEFAULT 1,
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
  `);
}

// === Users ===

export async function getUser(chatId) {
  if (!DB) return null;
  const row = await DB.prepare('SELECT * FROM wn3_users WHERE chat_id = ?').bind(chatId).first();
  return row || null;
}

export async function saveUser(chatId, data) {
  if (!DB) return;
  const existing = await getUser(chatId);
  if (existing) {
    const sets = Object.entries(data).map(([k, v]) => `${k} = ?`).join(', ');
    const vals = Object.values(data);
    await DB.prepare(`UPDATE wn3_users SET ${sets}, updated_at = datetime('now') WHERE chat_id = ?`).bind(...vals, chatId).run();
  } else {
    const cols = ['chat_id', ...Object.keys(data)];
    const placeholders = cols.map(() => '?').join(', ');
    const vals = [chatId, ...Object.values(data)];
    await DB.prepare(`INSERT INTO wn3_users (${cols.join(',')}) VALUES (${placeholders})`).bind(...vals).run();
  }
}

export async function getAllUsers() {
  if (!DB) return [];
  const rows = await DB.prepare('SELECT * FROM wn3_users WHERE enabled = 1').all();
  return rows.results || [];
}

// === User Settings ===

export async function getUserSettings(chatId) {
  if (!DB) return null;
  const row = await DB.prepare('SELECT * FROM wn3_user_settings WHERE chat_id = ?').bind(chatId).first();
  return row || null;
}

export async function saveUserSettings(chatId, data) {
  if (!DB) return;
  const existing = await getUserSettings(chatId);
  if (existing) {
    const sets = Object.entries(data).map(([k, v]) => `${k} = ?`).join(', ');
    const vals = Object.values(data);
    await DB.prepare(`UPDATE wn3_user_settings SET ${sets}, updated_at = datetime('now') WHERE chat_id = ?`).bind(...vals, chatId).run();
  } else {
    const cols = ['chat_id', ...Object.keys(data)];
    const placeholders = cols.map(() => '?').join(', ');
    const vals = [chatId, ...Object.values(data)];
    await DB.prepare(`INSERT INTO wn3_user_settings (${cols.join(',')}) VALUES (${placeholders})`).bind(...vals).run();
  }
}

// === Multi-Location ===

export async function getUserLocations(chatId) {
  if (!DB) return [];
  const rows = await DB.prepare('SELECT * FROM wn3_user_locations WHERE chat_id = ? ORDER BY id').bind(chatId).all();
  return rows.results || [];
}

export async function getDefaultLocation(chatId) {
  if (!DB) return null;
  const row = await DB.prepare('SELECT * FROM wn3_user_locations WHERE chat_id = ? AND is_default = 1').bind(chatId).first();
  if (row) return row;
  const first = await DB.prepare('SELECT * FROM wn3_user_locations WHERE chat_id = ? ORDER BY id LIMIT 1').bind(chatId).first();
  return first || null;
}

export async function addUserLocation(chatId, name, lat, lon) {
  if (!DB) return;
  const existing = await getUserLocations(chatId);
  const isDefault = existing.length === 0 ? 1 : 0;
  await DB.prepare(
    'INSERT INTO wn3_user_locations (chat_id, name, latitude, longitude, is_default) VALUES (?, ?, ?, ?, ?)'
  ).bind(chatId, name, lat, lon, isDefault).run();
}

export async function setDefaultLocation(chatId, locationId) {
  if (!DB) return;
  await DB.prepare('UPDATE wn3_user_locations SET is_default = 0 WHERE chat_id = ?').bind(chatId).run();
  await DB.prepare('UPDATE wn3_user_locations SET is_default = 1 WHERE id = ? AND chat_id = ?').bind(locationId, chatId).run();
}

export async function deleteUserLocation(chatId, locationId) {
  if (!DB) return;
  await DB.prepare('DELETE FROM wn3_user_locations WHERE id = ? AND chat_id = ?').bind(locationId, chatId).run();
}
