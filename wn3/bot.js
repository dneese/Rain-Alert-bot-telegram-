// ============================================
// WEATHERNEXT 3 - ОПТИМІЗОВАНА ВЕРСІЯ ДЛЯ CLOUDFLARE WORKERS
// ============================================

// ============================================
// 1. КОНФІГУРАЦІЯ ТА ЗМІННІ
// ============================================

var ENV = {};
var BOT_TOKEN = "";
var DB = null;
var DB_VERSION = 2;
var isDbInitialized = false;

// Переклади (i18n)
const translations = {
  uk: {
    settings_title: "⚙️ Налаштування",
    alerts_status: "🔔 Сповіщення",
    active_alerts: "📋 Активних алертів",
    units_label: "📏 Одиниці виміру",
    general: "⚙️ Загальні",
    alerts: "🔔 Сповіщення",
    thresholds: "📊 Пороги",
    locations: "📍 Локації",
    back: "◀️ Назад",
    enabled: "✅ Увімкнено",
    disabled: "❌ Вимкнено",
    general_settings: "⚙️ Загальні налаштування",
    language: "🌐 Мова",
    units: "📏 Одиниці",
    change: "Змінити",
    toggle: "Переключити",
    auto_update: "🔄 Автооновлення",
    imperial: "Імперські",
    metric: "Метричні",
    weather: "🌤 Погода",
    forecast: "📅 Прогноз",
    select_days: "Оберіть кількість днів:",
    add_location: "📍 Додати локацію",
    select_lang: "🌐 Оберіть мову",
    delete_loc_q: "⚠️ Видалити локацію?",
    confirm_delete: "✅ Так, видалити",
    cancel: "❌ Скасувати",
    deleted: "Локацію видалено",
    rename_loc: "✏️ Нова назва",
    enter_name: "Введіть нову назву локації:",
    done: "✅ Готово",
    alert_thresholds: "📊 Пороги алертів",
    alert_trigger_val: "⚡ Значення для спрацювання",
    reset: "↩️ Скинути",
    disable_all: "🔕 Викл все",
    enable_all: "🔔 Увімк все",
    threshold: "📊 Поріг",
    level: "🎚️ Рівень",
    status: "📢 Статус",
    set_threshold: "Встановити поріг",
    importance_level: "Рівень важливості",
    toggle_forecast: "📊 Перекл прогноз",
    toggle_alert: "❌ Перекл алерт",
  },
  en: {
    settings_title: "⚙️ Settings",
    alerts_status: "🔔 Notifications",
    active_alerts: "📋 Active alerts",
    units_label: "📏 Units",
    general: "⚙️ General",
    alerts: "🔔 Alerts",
    thresholds: "📊 Thresholds",
    locations: "📍 Locations",
    back: "◀️ Back",
    enabled: "✅ Enabled",
    disabled: "❌ Disabled",
    general_settings: "⚙️ General Settings",
    language: "🌐 Language",
    units: "📏 Units",
    change: "Change",
    toggle: "Toggle",
    auto_update: "🔄 Auto-update",
    imperial: "Imperial",
    metric: "Metric",
    weather: "🌤 Weather",
    forecast: "📅 Forecast",
    select_days: "Select number of days:",
    add_location: "📍 Add location",
    select_lang: "🌐 Select language",
    delete_loc_q: "⚠️ Delete location?",
    confirm_delete: "✅ Yes, delete",
    cancel: "❌ Cancel",
    deleted: "Location deleted",
    rename_loc: "✏️ New name",
    enter_name: "Enter new location name:",
    done: "✅ Done",
    alert_thresholds: "📊 Alert Thresholds",
    alert_trigger_val: "⚡ Trigger values",
    reset: "↩️ Reset",
    disable_all: "🔕 Disable all",
    enable_all: "🔔 Enable all",
    threshold: "📊 Threshold",
    level: "🎚️ Level",
    status: "📢 Status",
    set_threshold: "Set threshold",
    importance_level: "Importance level",
    toggle_forecast: "📊 Toggle forecast",
    toggle_alert: "❌ Toggle alert",
  },
  ru: {
    settings_title: "⚙️ Настройки",
    alerts_status: "🔔 Уведомления",
    active_alerts: "📋 Активных алептов",
    units_label: "📏 Единицы измерения",
    general: "⚙️ Общие",
    alerts: "🔔 Оповещения",
    thresholds: "📊 Пороги",
    locations: "📍 Локации",
    back: "◀️ Назад",
    enabled: "✅ Включено",
    disabled: "❌ Выключено",
    general_settings: "⚙️ Общие настройки",
    language: "🌐 Язык",
    units: "📏 Единицы",
    change: "Изменить",
    toggle: "Переключить",
    auto_update: "🔄 Автообновление",
    imperial: "Имперские",
    metric: "Метрические",
    weather: "🌤 Погода",
    forecast: "📅 Прогноз",
    select_days: "Выберите количество дней:",
    add_location: "📍 Добавить локацию",
    select_lang: "🌐 Выберите язык",
    delete_loc_q: "⚠️ Удалить локацию?",
    confirm_delete: "✅ Да, удалить",
    cancel: "❌ Отмена",
    deleted: "Локация удалена",
    rename_loc: "✏️ Новое название",
    enter_name: "Введите новое название локации:",
    done: "✅ Готово",
    alert_thresholds: "📊 Пороги алептов",
    alert_trigger_val: "⚡ Значения для срабатывания",
    reset: "↩️ Сбросить",
    disable_all: "🔕 Выкл все",
    enable_all: "🔔 Вкл все",
    threshold: "📊 Порог",
    level: "🎚️ Уровень",
    status: "📢 Статус",
    set_threshold: "Установить порог",
    importance_level: "Уровень важности",
    toggle_forecast: "📊 Перекл прогноз",
    toggle_alert: "❌ Перекл алерт",
  }
};

function t(lang, key, vars = {}) {
  const dict = translations[lang] || translations.uk;
  let str = dict[key] || translations.uk[key] || key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replaceAll(`{${k}}`, v);
  }
  return str;
}

// ============================================
// 2. ФУНКЦІЇ ДЛЯ РОБОТИ З БАЗОЮ ДАНИХ (DB)
// ============================================

function configureDb(env) {
  DB = env.DB || env.WN3_DB || null;
  if (!DB) {
    console.warn('[wn3/db] D1 binding not found');
  }
}

async function ensureColumns() {
  if (!DB) return;
  const cols = [
    ["storm_threshold", "INTEGER DEFAULT 70"],
    ["snow_threshold", "INTEGER DEFAULT 10"],
    ["last_weather_msg_id", "INTEGER DEFAULT 0"],
    ["last_weather_chat_id", "INTEGER DEFAULT 0"],
    ["last_weather_loc", "TEXT DEFAULT ''"],
    ["auto_update", "INTEGER DEFAULT 1"],
    ["units", "INTEGER DEFAULT 0"]
  ];
  for (const [col, def] of cols) {
    try {
      await DB.prepare(`ALTER TABLE wn3_user_settings ADD COLUMN ${col} ${def}`).run();
    } catch (e) {
      // Column exists
    }
  }
}

async function initDB() {
  if (!DB || isDbInitialized) return;
  
  let currentVersion = 0;
  try {
    const result = await DB.prepare("SELECT value FROM wn3_meta WHERE key = 'schema_version'").first();
    if (result) currentVersion = parseInt(result.value, 10) || 0;
  } catch (e) {
    // Таблиця wn3_meta ще не існує
  }

  if (currentVersion === 0) {
    await migrateV1();
    currentVersion = 1;
  }
  
  if (currentVersion === 1) {
    await migrateV2();
    currentVersion = 2;
  }

  await ensureColumns();
  
  try {
    await DB.prepare("CREATE TABLE IF NOT EXISTS wn3_meta (key TEXT PRIMARY KEY, value TEXT)").run();
    await DB.prepare("INSERT OR REPLACE INTO wn3_meta (key, value) VALUES ('schema_version', ?)")
      .bind(String(currentVersion)).run();
  } catch (e) {
    console.warn('[wn3/db] Meta update error:', e.message);
  }
  
  isDbInitialized = true;
}

async function migrateV1() {
  try {
    await DB.prepare(`CREATE TABLE IF NOT EXISTS wn3_users (
      chat_id INTEGER PRIMARY KEY,
      lang TEXT DEFAULT 'en',
      enabled INTEGER DEFAULT 1,
      alerts_enabled INTEGER DEFAULT 1,
      alert_level INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`).run();
  } catch (e) { console.warn('migrateV1 users:', e.message); }
  
  try {
    await DB.prepare(`CREATE TABLE IF NOT EXISTS wn3_user_settings (
      chat_id INTEGER PRIMARY KEY,
      wind_threshold INTEGER DEFAULT 40,
      rain_threshold INTEGER DEFAULT 15,
      heat_threshold INTEGER DEFAULT 35,
      cold_threshold INTEGER DEFAULT -20,
      storm_threshold INTEGER DEFAULT 70,
      snow_threshold INTEGER DEFAULT 10,
      last_weather_msg_id INTEGER DEFAULT 0,
      last_weather_chat_id INTEGER DEFAULT 0,
      last_weather_loc TEXT DEFAULT '',
      auto_update INTEGER DEFAULT 1,
      units INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    )`).run();
  } catch (e) { console.warn('migrateV1 settings:', e.message); }
  
  try {
    await DB.prepare(`CREATE TABLE IF NOT EXISTS wn3_user_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      name TEXT DEFAULT 'My Location',
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (chat_id) REFERENCES wn3_users(chat_id) ON DELETE CASCADE
    )`).run();
  } catch (e) { console.warn('migrateV1 locations:', e.message); }
  
  try {
    await DB.prepare("CREATE INDEX IF NOT EXISTS idx_wn3_users_enabled ON wn3_users(enabled) WHERE enabled = 1").run();
    await DB.prepare("CREATE INDEX IF NOT EXISTS idx_wn3_locs_chat ON wn3_user_locations(chat_id)").run();
    await DB.prepare("CREATE INDEX IF NOT EXISTS idx_wn3_locs_default ON wn3_user_locations(chat_id, is_default) WHERE is_default = 1").run();
  } catch (e) { console.warn('migrateV1 indexes:', e.message); }
}

async function migrateV2() {
  try {
    await DB.prepare(`CREATE TABLE IF NOT EXISTS wn3_alert_settings (
      chat_id INTEGER NOT NULL,
      alert_type TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      threshold REAL NOT NULL,
      level INTEGER DEFAULT 1,
      notify_forecast INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (chat_id, alert_type),
      FOREIGN KEY (chat_id) REFERENCES wn3_users(chat_id) ON DELETE CASCADE
    )`).run();
  } catch (e) { console.warn('migrateV2 alert_settings:', e.message); }
  
  try {
    await DB.prepare("CREATE INDEX IF NOT EXISTS idx_wn3_alert_settings_chat ON wn3_alert_settings(chat_id)").run();
    await DB.prepare("CREATE INDEX IF NOT EXISTS idx_wn3_alert_settings_type ON wn3_alert_settings(chat_id, alert_type)").run();
  } catch (e) { console.warn('migrateV2 indexes:', e.message); }
}

// ============================================
// 3. ФУНКЦІЇ ДЛЯ РОБОТИ З DB (CRUD)
// ============================================

async function getUser(chatId) {
  if (!DB) return null;
  const row = await DB.prepare("SELECT * FROM wn3_users WHERE chat_id = ?").bind(chatId).first();
  return row || null;
}

async function saveUser(chatId, data) {
  if (!DB) return;
  const allowedFields = ['lang', 'enabled', 'alerts_enabled', 'alert_level'];
  const filteredData = {};
  for (const [k, v] of Object.entries(data)) {
    if (allowedFields.includes(k)) filteredData[k] = v;
  }
  
  const existing = await getUser(chatId);
  if (existing) {
    const sets = Object.entries(filteredData).map(([k, v]) => `${k} = ?`).join(", ");
    const vals = Object.values(filteredData);
    await DB.prepare(`UPDATE wn3_users SET ${sets}, updated_at = datetime('now') WHERE chat_id = ?`)
      .bind(...vals, chatId).run();
  } else {
    const cols = ["chat_id", ...Object.keys(filteredData)];
    const placeholders = cols.map(() => "?").join(", ");
    const vals = [chatId, ...Object.values(filteredData)];
    await DB.prepare(`INSERT INTO wn3_users (${cols.join(",")}) VALUES (${placeholders})`)
      .bind(...vals).run();
  }
}

async function getAllUsers() {
  if (!DB) return [];
  const rows = await DB.prepare("SELECT * FROM wn3_users WHERE enabled = 1").all();
  return rows.results || [];
}

async function getUserSettings(chatId) {
  if (!DB) return null;
  const row = await DB.prepare("SELECT * FROM wn3_user_settings WHERE chat_id = ?").bind(chatId).first();
  return row || null;
}

async function saveUserSettings(chatId, data) {
  if (!DB) return;
  const allowedFields = ['wind_threshold', 'rain_threshold', 'heat_threshold', 'cold_threshold', 'storm_threshold', 'snow_threshold', 'last_weather_msg_id', 'last_weather_chat_id', 'last_weather_loc', 'auto_update', 'units'];
  const filteredData = {};
  for (const [k, v] of Object.entries(data)) {
    if (allowedFields.includes(k)) filteredData[k] = v;
  }
  
  const existing = await getUserSettings(chatId);
  if (existing) {
    const sets = Object.entries(filteredData).map(([k, v]) => `${k} = ?`).join(", ");
    const vals = Object.values(filteredData);
    await DB.prepare(`UPDATE wn3_user_settings SET ${sets}, updated_at = datetime('now') WHERE chat_id = ?`)
      .bind(...vals, chatId).run();
  } else {
    const cols = ["chat_id", ...Object.keys(filteredData)];
    const placeholders = cols.map(() => "?").join(", ");
    const vals = [chatId, ...Object.values(filteredData)];
    await DB.prepare(`INSERT INTO wn3_user_settings (${cols.join(",")}) VALUES (${placeholders})`)
      .bind(...vals).run();
  }
}

async function getUserLocations(chatId) {
  if (!DB) return [];
  const rows = await DB.prepare("SELECT * FROM wn3_user_locations WHERE chat_id = ? ORDER BY id")
    .bind(chatId).all();
  return rows.results || [];
}

async function getDefaultLocation(chatId) {
  if (!DB) return null;
  const row = await DB.prepare("SELECT * FROM wn3_user_locations WHERE chat_id = ? AND is_default = 1")
    .bind(chatId).first();
  if (row) return row;
  const first = await DB.prepare("SELECT * FROM wn3_user_locations WHERE chat_id = ? ORDER BY id LIMIT 1")
    .bind(chatId).first();
  return first || null;
}

async function addUserLocation(chatId, name, lat, lon) {
  if (!DB) return;
  const existing = await getUserLocations(chatId);
  const isDefault = existing.length === 0 ? 1 : 0;
  await DB.prepare(
    "INSERT INTO wn3_user_locations (chat_id, name, latitude, longitude, is_default) VALUES (?, ?, ?, ?, ?)"
  ).bind(chatId, name, lat, lon, isDefault).run();
}

async function getAlertSettings(chatId) {
  if (!DB) return [];
  const rows = await DB.prepare(
    "SELECT * FROM wn3_alert_settings WHERE chat_id = ? ORDER BY alert_type"
  ).bind(chatId).all();
  return rows.results || [];
}

async function getAlertSetting(chatId, alertType) {
  if (!DB) return null;
  const row = await DB.prepare(
    "SELECT * FROM wn3_alert_settings WHERE chat_id = ? AND alert_type = ?"
  ).bind(chatId, alertType).first();
  return row || null;
}

async function saveAlertSetting(chatId, alertType, data) {
  if (!DB) return;
  const allowedFields = ['enabled', 'threshold', 'level', 'notify_forecast'];
  const filteredData = {};
  for (const [k, v] of Object.entries(data)) {
    if (allowedFields.includes(k)) filteredData[k] = v;
  }
  
  const existing = await getAlertSetting(chatId, alertType);
  if (existing) {
    const sets = Object.entries(filteredData).map(([k, v]) => `${k} = ?`).join(", ");
    const vals = Object.values(filteredData);
    await DB.prepare(
      `UPDATE wn3_alert_settings SET ${sets}, updated_at = datetime('now') WHERE chat_id = ? AND alert_type = ?`
    ).bind(...vals, chatId, alertType).run();
  } else {
    const cols = ["chat_id", "alert_type", ...Object.keys(filteredData)];
    const placeholders = cols.map(() => "?").join(", ");
    const vals = [chatId, alertType, ...Object.values(filteredData)];
    await DB.prepare(
      `INSERT INTO wn3_alert_settings (${cols.join(",")}) VALUES (${placeholders})`
    ).bind(...vals).run();
  }
}

async function resetAlertSettings(chatId) {
  if (!DB) return;
  await DB.prepare("DELETE FROM wn3_alert_settings WHERE chat_id = ?").bind(chatId).run();
  
  const defaults = [
    { type: 'wind', threshold: 40 },
    { type: 'rain', threshold: 15 },
    { type: 'heat', threshold: 35 },
    { type: 'cold', threshold: -20 },
    { type: 'storm', threshold: 70 },
    { type: 'snow', threshold: 10 }
  ];
  
  const statements = defaults.map(setting => 
    DB.prepare(
      "INSERT INTO wn3_alert_settings (chat_id, alert_type, threshold, enabled, level, notify_forecast) VALUES (?, ?, ?, 1, 1, 1)"
    ).bind(chatId, setting.type, setting.threshold)
  );
  
  if (statements.length > 0) {
    await DB.batch(statements);
  }
}

// ============================================
// 4. ПОГОДНИЙ API
// ============================================

var API_KEY = "";
var TIMEOUT_MS = 15000;
var BASE_URL = "https://weather.googleapis.com/v1";

function configureWeather(env) {
  env = env || {};
  if (env.GOOGLE_WEATHER_API_KEY) API_KEY = env.GOOGLE_WEATHER_API_KEY;
  if (env.WEATHER_TIMEOUT_MS) TIMEOUT_MS = parseInt(env.WEATHER_TIMEOUT_MS, 10) || 15000;
}

async function weatherGet(path, params = {}) {
  if (!API_KEY) {
    throw new Error("Google Weather API key not configured");
  }
  const qs = new URLSearchParams({ key: API_KEY, ...params }).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}?${qs}`, { signal: controller.signal });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Weather API ${res.status}: ${txt.slice(0, 200)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCurrentWeather(lat, lon, lang = "en") {
  const data = await weatherGet("/currentConditions:lookup", {
    "location.latitude": lat,
    "location.longitude": lon,
    languageCode: lang,
    unitsSystem: "METRIC"
  });
  return {
    temperature: data.temperature?.degrees ?? null,
    feelsLike: data.feelsLikeTemperature?.degrees ?? null,
    humidity: data.relativeHumidity ?? null,
    windSpeed: data.wind?.speed?.value ?? null,
    windGust: data.wind?.gust?.value ?? null,
    windDir: data.wind?.direction?.cardinal ?? null,
    windDirDeg: data.wind?.direction?.degrees ?? null,
    cloudCover: data.cloudCover ?? null,
    pressure: data.airPressure?.meanSeaLevelMillibars ?? null,
    uvIndex: data.uvIndex ?? null,
    visibility: data.visibility?.distance ?? null,
    condition: data.weatherCondition?.description?.text ?? null,
    conditionType: data.weatherCondition?.type ?? null,
    iconUri: data.weatherCondition?.iconBaseUri ?? null,
    precipProb: data.precipitation?.probability?.percent ?? 0,
    precipType: data.precipitation?.probability?.type ?? null,
    precipQpf: data.precipitation?.qpf?.quantity ?? 0,
    thunderstormProb: data.thunderstormProbability ?? 0,
    isDaytime: data.isDaytime ?? true,
    currentTime: data.currentTime ?? null,
    timeZone: data.timeZone?.id ?? null
  };
}

async function fetchDailyForecast(lat, lon, days = 7, lang = "en") {
  const data = await weatherGet("/forecast/days:lookup", {
    "location.latitude": lat,
    "location.longitude": lon,
    languageCode: lang,
    unitsSystem: "METRIC",
    days: Math.min(days, 10)
  });
  return (data.forecastDays || []).map((d) => {
    const dd = d.displayDate;
    const dateStr = dd ? `${dd.year}-${String(dd.month).padStart(2, "0")}-${String(dd.day).padStart(2, "0")}` : null;
    return {
      date: dateStr,
      maxTemp: d.maxTemperature?.degrees ?? null,
      minTemp: d.minTemperature?.degrees ?? null,
      avgTemp: d.maxHeatIndex?.degrees ?? null,
      humidity: d.daytimeForecast?.relativeHumidity ?? d.nighttimeForecast?.relativeHumidity ?? null,
      windSpeed: d.daytimeForecast?.wind?.speed?.value ?? d.nighttimeForecast?.wind?.speed?.value ?? null,
      windDir: d.daytimeForecast?.wind?.direction?.cardinal ?? d.nighttimeForecast?.wind?.direction?.cardinal ?? null,
      cloudCover: d.daytimeForecast?.cloudCover ?? d.nighttimeForecast?.cloudCover ?? null,
      condition: d.daytimeForecast?.weatherCondition?.description?.text ?? d.nighttimeForecast?.weatherCondition?.description?.text ?? null,
      conditionType: d.daytimeForecast?.weatherCondition?.type ?? d.nighttimeForecast?.weatherCondition?.type ?? null,
      iconUri: d.daytimeForecast?.weatherCondition?.iconBaseUri ?? d.nighttimeForecast?.weatherCondition?.iconBaseUri ?? null,
      precipProb: d.daytimeForecast?.precipitation?.probability?.percent ?? d.nighttimeForecast?.precipitation?.probability?.percent ?? 0,
      precipQpf: d.daytimeForecast?.precipitation?.qpf?.quantity ?? d.nighttimeForecast?.precipitation?.qpf?.quantity ?? 0,
      uvIndex: d.uvIndex?.daytimeForecast?.uvIndex ?? null,
      sunrise: d.sunEvents?.sunriseTime ?? null,
      sunset: d.sunEvents?.sunsetTime ?? null
    };
  });
}

// ============================================
// 5. ФУНКЦІЇ ДЛЯ ПЕРЕВІРКИ АЛЕРТІВ
// ============================================

function formatLocalTime(tz) {
  try {
    return new Date().toLocaleTimeString("uk-UA", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  } catch {
    return new Date().toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" }) + " UTC";
  }
}

function checkAlertsWithSettings(current, forecast, alertSettings) {
  const alerts = [];
  const alertConfig = {};
  
  for (const setting of alertSettings) {
    alertConfig[setting.alert_type] = setting;
  }
  
  if (alertConfig.wind && alertConfig.wind.enabled !== 0 && current.windSpeed !== null) {
    const threshold = alertConfig.wind.threshold || 40;
    if (current.windSpeed >= threshold) {
      const level = current.windSpeed >= threshold * 2.5 ? 4 : current.windSpeed >= threshold * 1.8 ? 3 : current.windSpeed >= threshold * 1.2 ? 2 : 1;
      alerts.push({
        type: 'wind',
        level: Math.min(level, 4),
        message: `💨 Вітер: ${Math.round(current.windSpeed)} км/год`,
        value: current.windSpeed,
        threshold: threshold,
        forecast: false
      });
    }
  }
  
  if (alertConfig.rain && alertConfig.rain.enabled !== 0 && current.precipQpf !== null && current.precipQpf > 0) {
    const threshold = alertConfig.rain.threshold || 15;
    if (current.precipQpf >= threshold) {
      const level = current.precipQpf >= threshold * 2.5 ? 4 : current.precipQpf >= threshold * 1.8 ? 3 : current.precipQpf >= threshold * 1.2 ? 2 : 1;
      alerts.push({
        type: 'rain',
        level: Math.min(level, 4),
        message: `🌧️ Дощ: ${current.precipQpf.toFixed(1)} мм/год`,
        value: current.precipQpf,
        threshold: threshold,
        forecast: false
      });
    }
  }
  
  if (alertConfig.heat && alertConfig.heat.enabled !== 0 && current.temperature !== null) {
    const threshold = alertConfig.heat.threshold || 35;
    if (current.temperature >= threshold) {
      const level = current.temperature >= threshold * 1.5 ? 4 : current.temperature >= threshold * 1.2 ? 3 : 2;
      alerts.push({
        type: 'heat',
        level: Math.min(level, 4),
        message: `🔥 Спека: ${Math.round(current.temperature)}°C`,
        value: current.temperature,
        threshold: threshold,
        forecast: false
      });
    }
  }
  
  if (alertConfig.cold && alertConfig.cold.enabled !== 0 && current.temperature !== null) {
    const threshold = alertConfig.cold.threshold || -20;
    if (current.temperature <= threshold) {
      const level = current.temperature <= threshold * 1.5 ? 4 : current.temperature <= threshold * 1.2 ? 3 : 2;
      alerts.push({
        type: 'cold',
        level: Math.min(level, 4),
        message: `🥶 Мороз: ${Math.round(current.temperature)}°C`,
        value: current.temperature,
        threshold: threshold,
        forecast: false
      });
    }
  }
  
  if (alertConfig.storm && alertConfig.storm.enabled !== 0 && current.thunderstormProb !== null) {
    const threshold = alertConfig.storm.threshold || 70;
    if (current.thunderstormProb >= threshold) {
      const level = current.thunderstormProb >= 90 ? 4 : current.thunderstormProb >= 80 ? 3 : 2;
      alerts.push({
        type: 'storm',
        level: Math.min(level, 4),
        message: `⚡ Гроза: ${Math.round(current.thunderstormProb)}%`,
        value: current.thunderstormProb,
        threshold: threshold,
        forecast: false
      });
    }
  }
  
  if (forecast && forecast.length > 0) {
    if (alertConfig.rain && alertConfig.rain.notify_forecast !== 0) {
      const threshold = alertConfig.rain.threshold || 15;
      for (const day of forecast) {
        if (day.precipQpf !== null && day.precipQpf >= threshold) {
          alerts.push({
            type: 'forecast_rain',
            level: day.precipQpf >= threshold * 2 ? 3 : 2,
            message: `🌧️ Прогноз: дощ ${day.precipQpf.toFixed(1)} мм, ${formatDate(day.date)}`,
            forecast: true,
            date: day.date
          });
        }
      }
    }
    
    if (alertConfig.heat && alertConfig.heat.notify_forecast !== 0) {
      const threshold = alertConfig.heat.threshold || 35;
      for (const day of forecast) {
        if (day.maxTemp !== null && day.maxTemp >= threshold) {
          alerts.push({
            type: 'forecast_heat',
            level: day.maxTemp >= threshold * 1.5 ? 3 : 2,
            message: `🔥 Прогноз: спека ${Math.round(day.maxTemp)}°C, ${formatDate(day.date)}`,
            forecast: true,
            date: day.date
          });
        }
      }
    }
  }
  
  return alerts;
}

function formatDate(dateStr) {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'short' });
  } catch {
    return dateStr || '';
  }
}

// ============================================
// 6. ОБРОБНИК АЛЕРТІВ (SCHEDULED)
// ============================================

async function checkAndNotifyEnhanced(tgClient) {
  let users;
  try {
    users = await getAllUsers();
  } catch (e) {
    console.error("[wn3/alerts] DB error:", e.message);
    return { error: e.message };
  }
  
  if (!users || users.length === 0) return { processed: 0 };
  
  let processed = 0;
  for (const user of users) {
    if (user.alerts_enabled === 0) continue;
    try {
      const chatId = user.chat_id;
      const lang = user.lang || "en";
      const alertSettings = await getAlertSettings(chatId);
      const locations = await getUserLocations(chatId);
      
      if (!locations || locations.length === 0) continue;
      const defaultLoc = locations.find(l => l.is_default) || locations[0];
      
      const current = await fetchCurrentWeather(defaultLoc.latitude, defaultLoc.longitude, lang);
      const forecast = await fetchDailyForecast(defaultLoc.latitude, defaultLoc.longitude, 3, lang);
      
      const alerts = checkAlertsWithSettings(current, forecast, alertSettings);
      
      if (alerts.length > 0) {
        let msg = `⚠️ <b>ПОПЕРЕДЖЕННЯ</b>\n📍 ${defaultLoc.name}\n\n`;
        for (const a of alerts) {
          msg += `${a.message}\n`;
        }
        msg += `\n🕐 ${formatLocalTime(current.timeZone || "Europe/Kyiv")}`;
        await tgClient.sendMessage(chatId, msg, { parse_mode: "HTML" });
      }
      
      processed++;
    } catch (e) {
      console.error(`[wn3/alerts] User ${user.chat_id} error: ${e.message}`);
    }
  }
  return { processed };
}

// ============================================
// 7. ФУНКЦІЇ ДЛЯ ТЕЛЕГРАМ API
// ============================================

async function tgApi(method, body = {}) {
  if (!BOT_TOKEN) {
    throw new Error("BOT_TOKEN not configured");
  }
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const j = await res.json();
  if (!j.ok) console.error(`[tg/${method}]`, j.description?.slice(0, 300));
  return j;
}

async function sendRich(chatId, richMessage) {
  return tgApi("sendRichMessage", { chat_id: chatId, rich_message: richMessage });
}

async function editRich(chatId, messageId, richMessage) {
  return tgApi("editMessageText", { chat_id: chatId, message_id: messageId, rich_message: richMessage });
}

async function sendMessage(chatId, text, options = {}) {
  return tgApi("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...options });
}

async function answerCallback(callbackQueryId, text = "", showAlert = false) {
  return tgApi("answerCallbackQuery", { callback_query_id: callbackQueryId, text, show_alert: showAlert });
}

var tgClient = {
  sendMessage: (chatId, text, opts) => tgApi("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...opts }),
  editMessage: () => ({ ok: false }),
  answerCallback: (id, text, alert) => tgApi("answerCallbackQuery", { callback_query_id: id, text, show_alert: alert })
};

// ============================================
// 8. КОНФІГУРАЦІЯ
// ============================================

function configure(env) {
  ENV = env || {};
  BOT_TOKEN = ENV.WN3_BOT_TOKEN || ENV.BOT_TOKEN || "";
  configureDb(ENV);
  configureWeather(ENV);
}

// ============================================
// 9. ХЕЛПЕРИ ДЛЯ RichMessage
// ============================================

function btn(text, opts = {}) {
  if (typeof opts === "string") {
    const b = { text, callback_data: opts };
    if (arguments[2]) b.style = arguments[2];
    return b;
  }

  const button = { text };
  if (opts.style) button.style = opts.style;
  if (opts.callback_data) button.callback_data = opts.callback_data;
  if (opts.url) button.url = opts.url;
  if (opts.web_app) button.web_app = opts.web_app;
  if (opts.login_url) button.login_url = opts.login_url;
  if (opts.copy_text) button.copy_text = typeof opts.copy_text === 'string' ? { text: opts.copy_text } : opts.copy_text;
  if (opts.switch_inline_query !== undefined) button.switch_inline_query = opts.switch_inline_query;
  if (opts.switch_inline_query_current_chat !== undefined) button.switch_inline_query_current_chat = opts.switch_inline_query_current_chat;
  if (opts.disabled) button.disabled = opts.disabled;

  return button;
}

const rt = {
  text: (txt) => String(txt),
  bold: (text) => ({ type: "bold", text }),
  italic: (text) => ({ type: "italic", text }),
  underline: (text) => ({ type: "underline", text }),
  strikethrough: (text) => ({ type: "strikethrough", text }),
  spoiler: (text) => ({ type: "spoiler", text }),
  code: (text) => ({ type: "code", text }),
  customEmoji: (text, emojiId) => ({ type: "custom_emoji", text, custom_emoji_id: emojiId }),
  dateTime: (timestamp, format = "short") => ({ type: "date_time", timestamp, format }),
  url: (text, url) => ({ type: "url", text, url }),
  mention: (text, userId) => ({ type: "text_mention", text, user_id: userId })
};

function p(text) { 
  return { type: "paragraph", text: Array.isArray(text) ? text : String(text) }; 
}
function h(text, size = 2) { return { type: "heading", text, size }; }
function divider() { return { type: "divider" }; }
function footer(text) { return { type: "footer", text }; }
function cell(text, opts = {}) { return { text, ...opts }; }
function headerCell(text, align = "center") { return { text, is_header: true, align }; }
function table(cells, opts = {}) { return { type: "table", cells, ...opts }; }
function buttonsRow(btns, align = "center") { return { type: "buttons", align, buttons: btns }; }
function bold(t2) { return { type: "bold", text: String(t2) }; }

function chunkButtons(btns, perRow = 2) {
  const rows = [];
  for (let i = 0; i < btns.length; i += perRow) {
    rows.push(buttonsRow(btns.slice(i, i + perRow)));
  }
  return rows;
}

// ============================================
// 10. ДОПОМІЖНІ ФУНКЦІЇ
// ============================================

function boolVal(v, def = true) {
  if (v === null || v === undefined) return def;
  return v === true || v === 1 || v === "1";
}

function getDefaultThreshold(type) {
  const defaults = {
    wind: 40,
    rain: 15,
    heat: 35,
    cold: -20,
    storm: 70,
    snow: 10
  };
  return defaults[type] || 0;
}

function getThresholdValues(type, current) {
  const ranges = {
    wind: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    rain: [0.5, 1, 2, 5, 10, 15, 20, 30, 40, 50],
    heat: [20, 25, 30, 33, 35, 37, 39, 40, 42, 45],
    cold: [5, 0, -5, -10, -15, -20, -25, -30, -35, -40],
    storm: [30, 40, 50, 60, 70, 80, 85, 90, 95, 100],
    snow: [1, 2, 5, 10, 15, 20, 30, 40, 50, 75]
  };
  return ranges[type] || [current];
}

function getAlertTypeLabel(type) {
  const labels = {
    wind: '💨 Вітер',
    rain: '🌧️ Дощ',
    heat: '🔥 Спека',
    cold: '🥶 Мороз',
    storm: '⚡ Гроза',
    snow: '❄️ Сніг'
  };
  return labels[type] || type;
}

// ============================================
// 11. ІНТЕРФЕЙС КОРИСТУВАЧА (UI)
// ============================================

function mainBtns(lang) {
  return [
    ...chunkButtons([
      btn("🌤 Погода", { callback_data: "wn3_weather", style: "primary" }),
      btn("📅 Прогноз", { callback_data: "wn3_forecast", style: "primary" })
    ], 2),
    ...chunkButtons([
      btn("🔔 Алерти", { callback_data: "wn3_alerts" }),
      btn("⚙ Налаштування", { callback_data: "wn3_settings" })
    ], 2),
    buttonsRow([
      btn("📍 Поділитися локацією", { callback_data: "wn3_location", style: "link" })
    ])
  ];
}

function settingsBtns(lang) {
  return [
    ...chunkButtons([
      btn("⚙ Загальні", { callback_data: "settings_category_general", style: "primary" }),
      btn("🔔 Сповіщення", { callback_data: "settings_category_alerts", style: "primary" }),
      btn("📊 Пороги", { callback_data: "settings_category_thresholds", style: "primary" }),
      btn("📍 Локації", { callback_data: "settings_category_locations", style: "primary" })
    ], 2),
    buttonsRow([
      btn("◀️ Головне меню", { callback_data: "wn3_main", style: "link" })
    ])
  ];
}

function richWeather(current, tz) {
  const rows = [];
  rows.push([headerCell("🌡️ Температура", "center"), headerCell(`${Math.round(current.temperature)}°C`, "center")]);
  if (current.feelsLike != null)
    rows.push([cell("відчувається"), cell(`${Math.round(current.feelsLike)}°C`, { align: "right" })]);
  if (current.windSpeed != null) {
    const dir = current.windDir || "";
    let windVal = `${Math.round(current.windSpeed)} км/год ${dir}`;
    if (current.windGust && current.windGust > current.windSpeed * 1.3) windVal += ` ⚠️${Math.round(current.windGust)}`;
    rows.push([cell("💨 вітер"), cell(windVal, { align: "right" })]);
  }
  if (current.humidity != null)
    rows.push([cell("💧 вологість"), cell(`${current.humidity}%`, { align: "right" })]);
  if (current.cloudCover != null)
    rows.push([cell("☁️ хмарність"), cell(`${current.cloudCover}%`, { align: "right" })]);
  if (current.pressure != null)
    rows.push([cell("🔽 тиск"), cell(`${Math.round(current.pressure)} гПа`, { align: "right" })]);
  if (current.uvIndex != null)
    rows.push([cell("☀️ УФ"), cell(`${current.uvIndex}`, { align: "right" })]);
  if (current.precipQpf > 0)
    rows.push([cell("🌧️ опади"), cell(`${current.precipQpf.toFixed(1)} мм`, { align: "right" })]);
  if (current.condition)
    rows.push([cell(" "), cell(current.condition, { align: "right" })]);
  const blocks = [
    table(rows, { is_compact: true }),
    divider(),
    footer(`🕐 ${formatLocalTime(tz)}  •  📡 WeatherNext 3`)
  ];
  return blocks;
}

function richForecast(forecast) {
  const rows = [];
  rows.push([headerCell("дата"), headerCell("погода"), headerCell("🌡"), headerCell("💨")]);
  for (const d of forecast) {
    const date = d.date || "—";
    const high = d.maxTemp != null ? `${Math.round(d.maxTemp)}°` : "—";
    const low = d.minTemp != null ? `${Math.round(d.minTemp)}°` : "—";
    const wind = d.windSpeed != null ? `${Math.round(d.windSpeed)}` : "—";
    const cond = d.condition || "";
    rows.push([cell(date, { align: "left" }), cell(cond, { align: "left" }), 
                cell(`${low}—${high}`, { align: "center" }), cell(`${wind}км/год`, { align: "right" })]);
  }
  return [
    table(rows, { is_compact: true }),
    divider(),
    footer("📡 WeatherNext 3")
  ];
}

function richAlertsEnhanced(alerts, current, alertSettings) {
  const blocks = [
    h("🔔 Алерти", 1),
    divider()
  ];
  
  if (alerts.length === 0) {
    blocks.push(p([rt.bold("✅ Безпечно. Небезпечних погодних умов не виявлено.")]));
  } else {
    const currentAlerts = alerts.filter(a => !a.forecast);
    const forecastAlerts = alerts.filter(a => a.forecast);
    
    if (currentAlerts.length > 0) {
      blocks.push(h("⚡ Поточні", 2));
      for (const a of currentAlerts) {
        const levelEmoji = ['', '🟢', '🟡', '🟠', '🔴'][a.level] || '🟢';
        blocks.push(p([rt.bold(`${levelEmoji} ${a.message}`)]));
      }
    }
    
    if (forecastAlerts.length > 0) {
      blocks.push(h("📊 Прогноз", 2));
      for (const a of forecastAlerts) {
        blocks.push(p([rt.bold(`📅 ${a.message}`)]));
      }
    }
  }
  
  blocks.push(divider());
  blocks.push(h("📊 Поточна погода", 2));
  const cRows = [];
  cRows.push([cell("🌡 Температура"), cell(`${Math.round(current.temperature)}°C`, { align: "right" })]);
  if (current.windSpeed != null) cRows.push([cell("💨 Вітер"), cell(`${Math.round(current.windSpeed)} км/год`, { align: "right" })]);
  if (current.humidity != null) cRows.push([cell("💧 Вологість"), cell(`${current.humidity}%`, { align: "right" })]);
  if (current.precipQpf > 0) cRows.push([cell("🌧️ Опади"), cell(`${current.precipQpf.toFixed(1)} мм`, { align: "right" })]);
  blocks.push(table(cRows, { is_compact: true }));
  
  return blocks;
}

// ============================================
// 12. ОБРОБНИКИ КОМАНД
// ============================================

async function respondRich(chatId, msgId, blocks, btnBlocks) {
  const allBlocks = [...blocks];
  if (btnBlocks) {
    if (Array.isArray(btnBlocks)) allBlocks.push(...btnBlocks);
    else allBlocks.push(btnBlocks);
  }
  const richMsg = { blocks: allBlocks };
  if (msgId) {
    try {
      const r = await editRich(chatId, msgId, richMsg);
      if (r.ok) return { result: { message_id: msgId } };
    } catch (e) {
      if (e.message?.includes("message is not modified")) {
        return { result: { message_id: msgId } };
      }
    }
  }
  return await sendRich(chatId, richMsg);
}

async function handleStart(chatId, lang, msgId) {
  let user = await getUser(chatId);
  if (!user) {
    await saveUser(chatId, { lang, enabled: true, alerts_enabled: true, alert_level: 1 });
    await resetAlertSettings(chatId);
  }
  const loc = await getDefaultLocation(chatId);
  const blocks = [
    h("🌦 WeatherNext 3 Bot", 1),
    p("Точний прогноз від Google DeepMind"),
    divider()
  ];
  if (loc) {
    blocks.push(p([rt.bold(`📍 ${loc.name || "—"}`)]));
  } else {
    blocks.push(p("⚠️ Надішліть геолокацію для початку роботи"));
  }
  await respondRich(chatId, msgId, blocks, mainBtns(lang));
}

async function handleWeather(chatId, lang, msgId) {
  const loc = await getDefaultLocation(chatId);
  if (!loc) {
    await respondRich(chatId, msgId, [p("Спочатку надішліть свою локацію!")]);
    return null;
  }
  try {
    const current = await fetchCurrentWeather(loc.latitude, loc.longitude, lang);
    const tz = current.timeZone || "Europe/Kyiv";
    const blocks = richWeather(current, tz);
    const sent = await respondRich(chatId, msgId, blocks, mainBtns(lang));
    const newMsgId = sent?.result?.message_id || msgId;
    if (newMsgId) {
      await saveUserSettings(chatId, { 
        last_weather_msg_id: newMsgId, 
        last_weather_chat_id: chatId, 
        last_weather_loc: loc.name || "" 
      });
    }
    return newMsgId;
  } catch (e) {
    await respondRich(chatId, msgId, [p("❌ Не вдалося отримати прогноз.")]);
    return msgId;
  }
}

async function handleForecast(chatId, lang, days = 3, msgId) {
  const loc = await getDefaultLocation(chatId);
  if (!loc) {
    await respondRich(chatId, msgId, [p("Спочатку надішліть свою локацію!")]);
    return;
  }
  try {
    const forecast = await fetchDailyForecast(loc.latitude, loc.longitude, days, lang);
    const blocks = richForecast(forecast);
    await respondRich(chatId, msgId, blocks, mainBtns(lang));
  } catch (e) {
    await respondRich(chatId, msgId, [p("❌ Не вдалося отримати прогноз.")]);
  }
}

async function handleAlerts(chatId, lang, msgId) {
  const loc = await getDefaultLocation(chatId);
  if (!loc) {
    await respondRich(chatId, msgId, [p("Спочатку надішліть свою локацію!")]);
    return;
  }
  
  const alertSettings = await getAlertSettings(chatId);
  
  try {
    const current = await fetchCurrentWeather(loc.latitude, loc.longitude, lang);
    const forecast = await fetchDailyForecast(loc.latitude, loc.longitude, 3, lang);
    
    const alerts = checkAlertsWithSettings(current, forecast, alertSettings);
    const blocks = richAlertsEnhanced(alerts, current, alertSettings);
    await respondRich(chatId, msgId, blocks, mainBtns(lang));
  } catch (e) {
    await respondRich(chatId, msgId, [p("❌ Не вдалося отримати прогноз.")]);
  }
}

async function handleSettings(chatId, lang, msgId) {
  const user = await getUser(chatId);
  const alertSettings = await getAlertSettings(chatId);
  const settings = await getUserSettings(chatId);
  const currentLang = user?.lang || lang || 'uk';
  const unitsLabel = settings?.units === 1 ? t(currentLang, "imperial") : t(currentLang, "metric");
  
  const blocks = [
    h(t(currentLang, "settings_title"), 1),
    p("🧑‍💻 Налаштуйте сповіщення та пороги"),
    divider(),
    h("📊 Статус", 2),
    p(`${t(currentLang, "alerts_status")}: ${user?.alerts_enabled ? t(currentLang, "enabled") : t(currentLang, "disabled")}`),
    p(`${t(currentLang, "active_alerts")}: ${alertSettings.filter(a => a.enabled).length}/${alertSettings.length || 6}`),
    p(`${t(currentLang, "units_label")}: ${unitsLabel}`),
    divider()
  ];
  
  await respondRich(chatId, msgId, blocks, settingsBtns(currentLang));
}

async function handleGeneralSettings(chatId, lang, msgId) {
  const user = await getUser(chatId);
  const settings = await getUserSettings(chatId);
  const currentLang = user?.lang || lang || 'uk';
  const unitsLabel = settings?.units === 1 ? t(currentLang, "imperial") : t(currentLang, "metric");
  
  const blocks = [
    h(t(currentLang, "general_settings"), 1),
    p("Налаштування мови, одиниць вимірювання та автооновлення"),
    divider(),
    p(`${t(currentLang, "language")}: ${currentLang.toUpperCase()}`),
    p(`${t(currentLang, "units")}: ${unitsLabel}`),
    p(`${t(currentLang, "auto_update")}: ${settings?.auto_update !== 0 ? t(currentLang, "enabled") : t(currentLang, "disabled")}`),
    p(`${t(currentLang, "alerts_status")}: ${user?.alerts_enabled ? t(currentLang, "enabled") : t(currentLang, "disabled")}`),
    divider()
  ];
  
  const btns = [
    ...chunkButtons([
      btn(t(currentLang, "language"), { callback_data: "settings_lang", style: "primary" }),
      btn(t(currentLang, "units"), { callback_data: "settings_units", style: "primary" })
    ], 2),
    ...chunkButtons([
      btn(settings?.auto_update !== 0 ? "❌ Викл автооновлення" : "✅ Увімк автооновлення", 
          { callback_data: "settings_auto_update", style: settings?.auto_update !== 0 ? "danger" : "success" }),
      btn(user?.alerts_enabled ? "🔕 Викл сповіщення" : "🔔 Увімк сповіщення", 
          { callback_data: "settings_alerts_toggle", style: user?.alerts_enabled ? "danger" : "success" })
    ], 2),
    buttonsRow([btn(t(currentLang, "back"), { callback_data: "wn3_settings", style: "link" })])
  ];
  
  await respondRich(chatId, msgId, blocks, btns);
}

async function handleAlertSettings(chatId, lang, msgId) {
  const alertSettings = await getAlertSettings(chatId);
  const user = await getUser(chatId);
  const currentLang = user?.lang || lang || 'uk';
  
  const blocks = [
    h(t(currentLang, "alerts"), 1),
    p(`📢 Загальний статус: ${user?.alerts_enabled ? t(currentLang, "enabled") : t(currentLang, "disabled")}`),
    divider()
  ];
  
  const primaryType = alertTypes.find(t => t.primary);
  const otherTypes = alertTypes.filter(t => !t.primary);
  
  if (primaryType) {
    const setting = alertSettings.find(a => a.alert_type === primaryType.id);
    const status = setting?.enabled !== 0 ? '✅' : '❌';
    const level = setting?.level || 1;
    const levelEmoji = ['', '🟢', '🟡', '🟠', '🔴'][level] || '🟢';
    const threshold = setting?.threshold || getDefaultThreshold(primaryType.id);
    
    blocks.push(h(`🌧️ ${t(currentLang, primaryType.label)}`, 2));
    blocks.push(p(`${status} ${levelEmoji} Поріг: ${threshold}`));
    blocks.push(buttonsRow([
      btn("📝 Налаштувати", { callback_data: `alert_config_${primaryType.id}`, style: "primary" })
    ]));
  }
  
  for (const type of otherTypes) {
    const setting = alertSettings.find(a => a.alert_type === type.id);
    const status = setting?.enabled !== 0 ? '✅' : '❌';
    const level = setting?.level || 1;
    const levelEmoji = ['', '🟢', '🟡', '🟠', '🔴'][level] || '🟢';
    const threshold = setting?.threshold || getDefaultThreshold(type.id);
    
    blocks.push(p(`${type.icon} ${type.label}: ${status} ${levelEmoji} Поріг: ${threshold}`));
    blocks.push(buttonsRow([
      btn("📝 Налаштувати", { callback_data: `alert_config_${type.id}`, style: "secondary" })
    ]));
  }
  
  blocks.push(divider());
  blocks.push(buttonsRow([
    btn("🔕 Вимкнути всі", { callback_data: "alert_disable_all", style: "danger" }),
    btn("🔔 Увімкнути всі", { callback_data: "alert_enable_all", style: "success" }),
    btn("↩️ Скинути всі", { callback_data: "alert_reset_all", style: "danger" })
  ]));
  blocks.push(buttonsRow([btn(t(currentLang, "back"), { callback_data: "wn3_settings", style: "link" })]));
  
  await respondRich(chatId, msgId, blocks, []);
}

async function handleAlertConfig(chatId, lang, alertType, msgId) {
  const user = await getUser(chatId);
  const currentLang = user?.lang || lang || 'uk';
  const setting = await getAlertSetting(chatId, alertType);
  const defaultThreshold = getDefaultThreshold(alertType);
  const currentThreshold = setting?.threshold !== undefined && setting?.threshold !== null ? setting.threshold : defaultThreshold;
  const level = setting?.level || 1;
  const status = setting?.enabled !== 0;
  const forecastEnabled = setting?.notify_forecast !== 0;
  
  const isRain = alertType === 'rain';
  
  const blocks = [
    h(`📝 Налаштування: ${getAlertTypeLabel(alertType)}`, 1),
    divider(),
    p(`📊 Поточний поріг: ${currentThreshold}`),
    p(`🎚️ Рівень небезпеки: ${['', '🟢 Низький', '🟡 Середній', '🟠 Високий', '🔴 Екстремальний'][level] || '🟢 Низький'}`),
    p(`📢 Статус: ${status ? t(currentLang, "enabled") : t(currentLang, "disabled")}`),
    p(`📊 Прогноз: ${forecastEnabled ? '✅ Так' : '❌ Ні'}`),
  ];
  
  if (isRain) {
    const lookaheadMin = setting?.lookahead_min || 30;
    blocks.push(p(`👁️ Вікно прогнозу: ${lookaheadMin} хв`));
    blocks.push(buttonsRow([
      btn("⏱ 15 хв", { callback_data: `alert_lookahead_15_${alertType}`, style: lookaheadMin === 15 ? "success" : undefined }),
      btn("⏱ 30 хв", { callback_data: `alert_lookahead_30_${alertType}`, style: lookaheadMin === 30 ? "primary" : undefined }),
      btn("⏱ 60 хв", { callback_data: `alert_lookahead_60_${alertType}`, style: lookaheadMin === 60 ? "primary" : undefined }),
      btn("⏱ 120 хв", { callback_data: `alert_lookahead_120_${alertType}`, style: lookaheadMin === 120 ? "danger" : undefined })
    ]));
    
    const trajectory = setting?.exp_trajectory || false;
    blocks.push(buttonsRow([
      btn(trajectory ? "❌ Вимкнути траєкторію" : "✅ Увімкнути траєкторію", 
          { callback_data: `alert_trajectory_toggle_${alertType}`, style: trajectory ? "danger" : "success" })
    ]));
    
    blocks.push(buttonsRow([
      btn("📏 Радіус: 10 км", { callback_data: `alert_radius_10_${alertType}`, style: (setting?.exp_radius_km || 10) === 10 ? "success" : undefined }),
      btn("📏 Радіusz: 20 км", { callback_data: `alert_radius_20_${alertType}`, style: (setting?.exp_radius_km || 10) !== 20 ? "primary" : undefined }),
      btn("📏 Радіusz: 50 км", { callback_data: `alert_radius_50_${alertType}`, style: (setting?.exp_radius_km || 10) !== 50 ? "primary" : undefined })
    ]));
  }
  
  const values = getThresholdValues(alertType, currentThreshold);
  const valBtns = values.map(v => 
    btn(v === currentThreshold ? `✅ ${v}` : `${v}`, 
        { callback_data: `threshold_value_${alertType}_${v}`, style: v === currentThreshold ? "primary" : undefined })
  );
  blocks.push(h("📊 Встановити поріг", 2));
  blocks.push(...chunkButtons(valBtns, 4));
  
  blocks.push(h("🎚️ Рівень небезпеки", 2));
  const levelBtns = [
    btn("🟢 Низький", { callback_data: `alert_level_set_${alertType}_1`, style: level === 1 ? "success" : undefined }),
    btn("🟡 Середній", { callback_data: `alert_level_set_${alertType}_2`, style: level === 2 ? "primary" : undefined }),
    btn("🟠 Високий", { callback_data: `alert_level_set_${alertType}_3`, style: level === 3 ? "primary" : undefined }),
    btn("🔴 Екстремальний", { callback_data: `alert_level_set_${alertType}_4`, style: level === 4 ? "danger" : undefined })
  ];
  blocks.push(...chunkButtons(levelBtns, 4));
  
  blocks.push(h("📊 Прогноз", 2));
  blocks.push(buttonsRow([
    btn(forecastEnabled ? "❌ Викл прогноз" : "✅ Увімк прогноз", 
        { callback_data: `alert_forecast_${alertType}`, style: forecastEnabled ? "danger" : "success" })
  ]));
  
  blocks.push(buttonsRow([
    btn(status ? "❌ Вимкнути сповіщення" : "✅ Увімкнути сповіщення", 
        { callback_data: `alert_toggle_${alertType}`, style: status ? "danger" : "success" })
  ]));
  
  blocks.push(divider());
  blocks.push(buttonsRow([btn(t(currentLang, "back"), { callback_data: "settings_category_alerts", style: "link" })]));
  
  await respondRich(chatId, msgId, blocks, []);
}

async function handleThresholdSettings(chatId, lang, msgId) {
  const alertSettings = await getAlertSettings(chatId);
  const user = await getUser(chatId);
  const currentLang = user?.lang || lang || 'uk';
  
  const blocks = [
    h(t(currentLang, "thresholds"), 1),
    p("⚡ Встановіть значення для спрацювання сповіщень"),
    divider()
  ];
  
  const primaryType = alertTypes.find(t => t.primary);
  const otherTypes = alertTypes.filter(t => !t.primary);
  
  if (primaryType) {
    const setting = alertSettings.find(a => a.alert_type === primaryType.id);
    const currentValue = setting?.threshold !== undefined && setting?.threshold !== null ? setting.threshold : getDefaultThreshold(primaryType.id);
    const status = setting?.enabled !== 0 ? '✅' : '❌';
    
    blocks.push(p(`${primaryType.icon} ${t(currentLang, primaryType.label)}: ${currentValue} ${status}`));
    blocks.push(buttonsRow([
      btn("📝 Змінити", { callback_data: `alert_config_${primaryType.id}`, style: "primary" })
    ]));
  }
  
  for (const type of otherTypes) {
    const setting = alertSettings.find(a => a.alert_type === type.id);
    const currentValue = setting?.threshold !== undefined && setting?.threshold !== null ? setting.threshold : getDefaultThreshold(type.id);
    const status = setting?.enabled !== 0 ? '✅' : '❌';
    
    blocks.push(p(`${type.icon} ${type.label}: ${currentValue} ${status}`));
    blocks.push(buttonsRow([
      btn("📝 Змінити", { callback_data: `alert_config_${type.id}`, style: "secondary" })
    ]));
  }
  
  blocks.push(divider());
  blocks.push(buttonsRow([
    btn("↩️ Скинути всі", { callback_data: "threshold_reset_all", style: "danger" }),
    btn(t(currentLang, "back"), { callback_data: "wn3_settings", style: "link" })
  ]));
  
  await respondRich(chatId, msgId, blocks, []);
}

async function handleLocations(chatId, lang, msgId) {
  const locations = await getUserLocations(chatId);
  const user = await getUser(chatId);
  const currentLang = user?.lang || lang || 'uk';
  
  const blocks = [
    h(t(currentLang, "locations"), 1),
    p(`📌 Всього: ${locations.length} локацій`),
    divider()
  ];
  
  for (const loc of locations) {
    const isDefault = loc.is_default ? "⭐" : "📍";
    blocks.push(p(`${isDefault} ${loc.name}`));
  }
  
  if (locations.length === 0) {
    blocks.push(p("⚠️ Локацій не додано. Надішліть геолокацію."));
  }
  
  blocks.push(divider());
  blocks.push(buttonsRow([
    btn(t(currentLang, "add_location"), { callback_data: "wn3_location", style: "primary" }),
    btn(t(currentLang, "back"), { callback_data: "wn3_settings", style: "link" })
  ]));
  
  await respondRich(chatId, msgId, blocks, []);
}

// ============================================
// 13. ОСНОВНІ ОБРОБНИКИ
// ============================================

async function handleCallbackQuery(callbackQuery) {
  const data = callbackQuery.data;
  const chatId = callbackQuery.message?.chat?.id;
  const msgId = callbackQuery.message?.message_id;
  if (!chatId || !data) return;
  await answerCallback(callbackQuery.id);
  let user = await getUser(chatId);
  let lang = user?.lang || "en";
  
  try {
    if (data === "wn3_weather") {
      await handleWeather(chatId, lang, msgId);
    } else if (data === "wn3_forecast") {
      const blocks = [h(t(lang, "select_days"))];
      const dayBtns = [1, 3, 5, 7, 10].map((d) => btn(d === 10 ? "🔟" : `${d}️⃣`, { callback_data: `wn3_fc_${d}`, style: "primary" }));
      const btns = [...chunkButtons(dayBtns, 5), buttonsRow([btn(t(lang, "back"), { callback_data: "wn3_main", style: "link" })])];
      await respondRich(chatId, msgId, blocks, btns);
    } else if (data.startsWith("wn3_fc_")) {
      const days = parseInt(data.split("_")[2], 10);
      await handleForecast(chatId, lang, days, msgId);
    } else if (data === "wn3_alerts") {
      await handleAlerts(chatId, lang, msgId);
    } else if (data === "wn3_settings") {
      await handleSettings(chatId, lang, msgId);
    } else if (data === "wn3_main") {
      await handleStart(chatId, lang, msgId);
    } else if (data === "wn3_location") {
      await respondRich(chatId, msgId, [p(t(lang, "add_location"))]);
    } else if (data.startsWith("settings_category_")) {
      const category = data.split("_")[2];
      switch (category) {
        case 'general': await handleGeneralSettings(chatId, lang, msgId); break;
        case 'alerts': await handleAlertSettings(chatId, lang, msgId); break;
        case 'thresholds': await handleThresholdSettings(chatId, lang, msgId); break;
        case 'locations': await handleLocations(chatId, lang, msgId); break;
      }
    } else if (data.startsWith("alert_config_")) {
      const alertType = data.split("_")[2];
      await handleAlertConfig(chatId, lang, alertType, msgId);
    } else if (data.startsWith("alert_toggle_")) {
      const alertType = data.split("_")[2];
      const setting = await getAlertSetting(chatId, alertType);
      const currentStatus = setting?.enabled !== 0;
      await saveAlertSetting(chatId, alertType, { enabled: currentStatus ? 0 : 1 });
      await handleAlertConfig(chatId, lang, alertType, msgId);
    } else if (data.startsWith("alert_level_set_")) {
      const parts = data.split("_");
      const alertType = parts[3];
      const level = parseInt(parts[4], 10);
      await saveAlertSetting(chatId, alertType, { level });
      await handleAlertConfig(chatId, lang, alertType, msgId);
    } else if (data.startsWith("alert_forecast_")) {
      const alertType = data.split("_")[2];
      const setting = await getAlertSetting(chatId, alertType);
      const currentStatus = setting?.notify_forecast !== 0;
      await saveAlertSetting(chatId, alertType, { notify_forecast: currentStatus ? 0 : 1 });
      await handleAlertConfig(chatId, lang, alertType, msgId);
    } else if (data === "alert_disable_all") {
      const settings = await getAlertSettings(chatId);
      for (const s of settings) {
        await saveAlertSetting(chatId, s.alert_type, { enabled: 0 });
      }
      await handleAlertSettings(chatId, lang, msgId);
    } else if (data === "alert_enable_all") {
      const settings = await getAlertSettings(chatId);
      for (const s of settings) {
        await saveAlertSetting(chatId, s.alert_type, { enabled: 1 });
      }
      await handleAlertSettings(chatId, lang, msgId);
    } else if (data === "alert_reset_all") {
      await resetAlertSettings(chatId);
      await handleAlertSettings(chatId, lang, msgId);
    } else if (data.startsWith("threshold_value_")) {
      const rest = data.replace("threshold_value_", "");
      const lastIdx = rest.lastIndexOf("_");
      const type = rest.substring(0, lastIdx);
      const value = parseFloat(rest.substring(lastIdx + 1));
      if (!isNaN(value)) {
        await saveAlertSetting(chatId, type, { threshold: value });
      }
      await handleAlertConfig(chatId, lang, type, msgId);
    } else if (data === "threshold_reset_all") {
      await resetAlertSettings(chatId);
      await handleThresholdSettings(chatId, lang, msgId);
    } else if (data.startswith("alert_lookahead_")) {
      const parts = data.split("_");
      const alertType = parts[2];
      const lookahead = parseInt(parts[3], 10);
      const setting = await getAlertSetting(chatId, alertType);
      if (setting) {
        await saveAlertSetting(chatId, alertType, { lookahead_min: lookahead });
      }
      await handleAlertConfig(chatId, lang, alertType, msgId);
    } else if (data.startswith("alert_trajectory_toggle_")) {
      const alertType = data.split("_")[3];
      const setting = await getAlertSetting(chatId, alertType);
      if (setting) {
        const newTrajectory = !(setting.exp_trajectory || false);
        await saveAlertSetting(chatId, alertType, { exp_trajectory: newTrajectory });
      }
      await handleAlertConfig(chatId, lang, alertType, msgId);
    } else if (data.startswith("alert_radius_")) {
      const parts = data.split("_");
      const alertType = parts[2];
      const radius = parseInt(parts[3], 10);
      const setting = await getAlertSetting(chatId, alertType);
      if (setting) {
        await saveAlertSetting(chatId, alertType, { exp_radius_km: radius });
      }
      await handleAlertConfig(chatId, lang, alertType, msgId);
    } else if (data.startswith("threshold_value_")) {
      const blocks = [h(t(lang, "select_lang"))];
      const langs = [
        { code: 'uk', flag: '🇺🇦', label: 'Українська' },
        { code: 'en', flag: '🇬🇧', label: 'English' },
        { code: 'ru', flag: '🇷🇺', label: 'Русский' }
      ];
      const langBtns = langs.map(l => 
        btn(`${l.flag} ${l.label}`, { callback_data: `lang_set_${l.code}`, style: lang === l.code ? "success" : undefined })
      );
      const btns = [...chunkButtons(langBtns, 2), buttonsRow([btn(t(lang, "back"), { callback_data: "settings_category_general", style: "link" })])];
      await respondRich(chatId, msgId, blocks, btns);
    } else if (data.startsWith("lang_set_")) {
      const newLang = data.split("_")[2];
      await saveUser(chatId, { lang: newLang });
      await handleGeneralSettings(chatId, newLang, msgId);
    } else if (data === "settings_units") {
      const settings = await getUserSettings(chatId);
      const current = settings?.units || 0;
      await saveUserSettings(chatId, { units: current === 0 ? 1 : 0 });
      await handleGeneralSettings(chatId, lang, msgId);
    } else if (data === "settings_auto_update") {
      const settings = await getUserSettings(chatId);
      const current = settings?.auto_update !== 0;
      await saveUserSettings(chatId, { auto_update: current ? 0 : 1 });
      await handleGeneralSettings(chatId, lang, msgId);
    } else if (data === "settings_alerts_toggle") {
      const user = await getUser(chatId);
      const current = user?.alerts_enabled !== 0;
      await saveUser(chatId, { alerts_enabled: current ? 0 : 1 });
      await handleGeneralSettings(chatId, lang, msgId);
    }
  } catch (e) {
    console.error("[wn3/callback] Error:", e.message);
  }
}

async function handleMessage(message) {
  const chatId = message.chat?.id;
  if (!chatId) return;
  const text = message.text || "";
  const location = message.location;
  let user = await getUser(chatId);
  let lang = user?.lang || "en";
  
  if (!user) {
    await saveUser(chatId, { lang, enabled: true, alerts_enabled: true, alert_level: 1 });
    await resetAlertSettings(chatId);
  }
  
  if (location) {
    const name = `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`;
    await addUserLocation(chatId, name, location.latitude, location.longitude);
    await sendMessage(chatId, `✅ Локацію збережено!`);
    await handleStart(chatId, lang);
    return;
  }
  
  if (text.startsWith("/start") || text === "🏠 Головне меню") {
    await handleStart(chatId, lang);
  } else if (text.startsWith("/weather")) {
    await handleWeather(chatId, lang);
  } else if (text.startsWith("/forecast")) {
    const d = parseInt(text.split(" ")[1] || "3", 10);
    await handleForecast(chatId, lang, Math.min(Math.max(d, 1), 10));
  } else if (text.startsWith("/alerts")) {
    await handleAlerts(chatId, lang);
  } else if (text.startsWith("/settings")) {
    await handleSettings(chatId, lang);
  } else if (text === "🌤 Погода") {
    await handleWeather(chatId, lang);
  } else if (text === "📅 Прогноз") {
    await handleForecast(chatId, lang);
  } else if (text === "🔔 Алерти") {
    await handleAlerts(chatId, lang);
  } else if (text === "⚙ Налаштування") {
    await handleSettings(chatId, lang);
  }
}

async function handleRequest(update) {
  if (!update) return { ok: false, error: "no update" };
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return { ok: true };
  }
  if (update.message) {
    await handleMessage(update.message);
    return { ok: true };
  }
  return { ok: true };
}

async function runScheduled() {
  try {
    await initDB();
    return await checkAndNotifyEnhanced(tgClient);
  } catch (e) {
    console.error("[wn3/scheduled] Error:", e.message);
    return { error: e.message };
  }
}

// ============================================
// 14. CLOUDFLARE WORKER ENTRY POINT
// ============================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    configure(env);
    await initDB();
    
    if (path === "/" || path === "/health") {
      return new Response(JSON.stringify({ status: "ok", bot: "wn3", model: "WeatherNext 3" }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    if (path === "/wn3/webhook" && request.method === "POST") {
      try {
        const update = await request.json();
        const result = await handleRequest(update);
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
    
    if (path === "/wn3/check" && request.method === "GET") {
      const result = await runScheduled();
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    return new Response(JSON.stringify({ ok: false, error: "not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  },
  
  async scheduled(event, env, ctx) {
    configure(env);
    await initDB();
    return await runScheduled();
  }
};
