// ============================================
// WEATHERNEXT 3 - МІНІМАЛЬНА ВЕРСІЯ ДЛЯ СЕБЕ
// ============================================

var ENV = {};
var BOT_TOKEN = "";
var MY_CHAT_ID = 0;
var API_KEY = "";
var DB = null;
var isDbInitialized = false;

// ============================================
// 1A. БАЗА ДАНИХ (D1) — зберігання локації
// ============================================

async function initDB() {
  if (!DB || isDbInitialized) return;
  try {
    await DB.prepare(`CREATE TABLE IF NOT EXISTS wn3_mini_location (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT DEFAULT 'Моя локація',
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )`).run();
    await DB.prepare(`CREATE TABLE IF NOT EXISTS wn3_mini_chat (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      chat_id INTEGER NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )`).run();
    isDbInitialized = true;
  } catch (e) {
    console.error('[wn3-mini/db] init error:', e.message);
  }
}

async function loadLocationFromDb() {
  if (!DB) return null;
  try {
    const row = await DB.prepare("SELECT * FROM wn3_mini_location WHERE id = 1").first();
    return row ? { name: row.name, lat: row.latitude, lon: row.longitude } : null;
  } catch (e) {
    console.error('[wn3-mini/db] load loc error:', e.message);
    return null;
  }
}

async function saveLocationToDb(lat, lon, name) {
  if (!DB) return;
  try {
    await DB.prepare(`INSERT INTO wn3_mini_location (id, name, latitude, longitude, updated_at)
      VALUES (1, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, latitude = excluded.latitude, longitude = excluded.longitude, updated_at = datetime('now')`)
      .bind(name || "Моя локація", lat, lon).run();
  } catch (e) {
    console.error('[wn3-mini/db] save loc error:', e.message);
  }
}

async function loadChatIdFromDb() {
  if (!DB) return null;
  try {
    const row = await DB.prepare("SELECT chat_id FROM wn3_mini_chat WHERE id = 1").first();
    return row ? row.chat_id : null;
  } catch (e) {
    console.error('[wn3-mini/db] load chat error:', e.message);
    return null;
  }
}

async function saveChatIdToDb(chatId) {
  if (!DB || !chatId) return;
  try {
    await DB.prepare(`INSERT INTO wn3_mini_chat (id, chat_id, updated_at)
      VALUES (1, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET chat_id = excluded.chat_id, updated_at = datetime('now')`)
      .bind(chatId).run();
  } catch (e) {
    console.error('[wn3-mini/db] save chat error:', e.message);
  }
}

// ============================================
// 1. НАЛАШТУВАННЯ
// ============================================

function configure(env) {
  ENV = env || {};
  BOT_TOKEN = ENV.WN3_BOT_TOKEN || ENV.BOT_TOKEN || "";
  MY_CHAT_ID = parseInt(ENV.MY_CHAT_ID || "0", 10);
  API_KEY = ENV.GOOGLE_WEATHER_API_KEY || "";
  DB = env.DB || null;
}

var LOCATION = null;

// ============================================
// 2. ПОГОДНИЙ API
// ============================================

var BASE_URL = "https://weather.googleapis.com/v1";
var TIMEOUT_MS = 15000;

async function weatherGet(path, params = {}) {
  if (!API_KEY) throw new Error("API key not configured");
  const qs = new URLSearchParams({ key: API_KEY, ...params }).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}?${qs}`, { signal: controller.signal });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`API ${res.status}: ${txt.slice(0, 200)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getWeather(lat, lon, lang = "uk") {
  const data = await weatherGet("/currentConditions:lookup", {
    "location.latitude": lat,
    "location.longitude": lon,
    languageCode: lang,
    unitsSystem: "METRIC"
  });
  return {
    temp: data.temperature?.degrees ?? null,
    feels: data.feelsLikeTemperature?.degrees ?? null,
    humid: data.relativeHumidity ?? null,
    wind: data.wind?.speed?.value ?? null,
    gust: data.wind?.gust?.value ?? null,
    dir: data.wind?.direction?.cardinal ?? null,
    cloud: data.cloudCover ?? null,
    press: data.airPressure?.meanSeaLevelMillibars ?? null,
    uv: data.uvIndex ?? null,
    cond: data.weatherCondition?.description?.text ?? null,
    precip: data.precipitation?.probability?.percent ?? 0,
    qpf: data.precipitation?.qpf?.quantity ?? 0,
    storm: data.thunderstormProbability ?? 0,
    tz: data.timeZone?.id ?? "Europe/Kyiv"
  };
}

async function getForecast(lat, lon, days = 3, lang = "uk") {
  const data = await weatherGet("/forecast/days:lookup", {
    "location.latitude": lat,
    "location.longitude": lon,
    languageCode: lang,
    unitsSystem: "METRIC",
    days: Math.min(days, 7)
  });
  return (data.forecastDays || []).map((d) => {
    const dd = d.displayDate;
    const dateStr = dd ? `${dd.year}-${String(dd.month).padStart(2, "0")}-${String(dd.day).padStart(2, "0")}` : null;
    return {
      date: dateStr,
      max: d.maxTemperature?.degrees ?? null,
      min: d.minTemperature?.degrees ?? null,
      wind: d.daytimeForecast?.wind?.speed?.value ?? null,
      dir: d.daytimeForecast?.wind?.direction?.cardinal ?? null,
      cond: d.daytimeForecast?.weatherCondition?.description?.text ?? null,
      precip: d.daytimeForecast?.precipitation?.probability?.percent ?? d.nighttimeForecast?.precipitation?.probability?.percent ?? 0,
      qpf: d.daytimeForecast?.precipitation?.qpf?.quantity ?? d.nighttimeForecast?.precipitation?.qpf?.quantity ?? 0,
      sunrise: d.sunEvents?.sunriseTime ?? null,
      sunset: d.sunEvents?.sunsetTime ?? null
    };
  });
}

// ============================================
// 3. TELEGRAM
// ============================================

async function tg(method, body = {}) {
  if (!BOT_TOKEN) throw new Error("BOT_TOKEN not configured");
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const j = await res.json();
  if (!j.ok) console.error(`[tg/${method}]`, j.description?.slice(0, 300));
  return j;
}

async function send(chatId, text) {
  return tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
}

// ============================================
// 4. ФОРМАТУВАННЯ
// ============================================

function fmtTime() {
  return new Date().toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(d) {
  if (!d) return "—";
  try {
    const dt = new Date(d);
    return dt.toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'short' });
  } catch { return d; }
}

function weatherEmoji(precip) {
  if (precip >= 70) return "🌧️";
  if (precip >= 40) return "🌥️";
  return "☀️";
}

// ============================================
// 5. ОСНОВНА ЛОГІКА
// ============================================

var alertCache = {};

function cleanCache() {
  const now = Date.now();
  for (const key in alertCache) {
    if (now - alertCache[key] > 3600000) {
      delete alertCache[key];
    }
  }
}

async function checkWeather(lat, lon) {
  const w = await getWeather(lat, lon);
  const f = await getForecast(lat, lon, 2);
  
  const alerts = [];
  const now = fmtTime();
  const today = new Date().toISOString().slice(0, 10);
  
  if (w.qpf >= 0.5 && w.precip >= 50) {
    const key = `rain_now_${today}`;
    if (!alertCache[key]) {
      alertCache[key] = Date.now();
      alerts.push({
        emoji: "🌧️",
        title: "Йде дощ!",
        text: `💧 ${w.qpf.toFixed(1)} мм | 🌡 ${Math.round(w.temp)}°C | 🕐 ${now}`
      });
    }
  }
  
  if (w.precip >= 70 && w.qpf < 0.5) {
    const key = `rain_soon_${today}`;
    if (!alertCache[key]) {
      alertCache[key] = Date.now();
      alerts.push({
        emoji: "☂️",
        title: "Скоро дощ!",
        text: `📊 Ймовірність ${Math.round(w.precip)}% | 🌡 ${Math.round(w.temp)}°C | 🕐 ${now}`
      });
    }
  }
  
  if (w.wind && w.wind >= 50) {
    const key = `wind_${today}`;
    if (!alertCache[key]) {
      alertCache[key] = Date.now();
      alerts.push({
        emoji: "💨",
        title: "Сильний вітер!",
        text: `🌬 ${Math.round(w.wind)} км/год | 💨 пориви до ${Math.round(w.gust || w.wind)} км/год`
      });
    }
  }
  
  if (f && f.length > 0 && f[0].precip >= 60) {
    const key = `forecast_today_${today}`;
    if (!alertCache[key]) {
      alertCache[key] = Date.now();
      const d = f[0];
      alerts.push({
        emoji: "📅",
        title: `Прогноз: ${fmtDate(d.date)}`,
        text: `🌧 ${Math.round(d.precip)}% | 💧 ${d.qpf.toFixed(1)} мм | 🌡 ${Math.round(d.min)}°—${Math.round(d.max)}°`
      });
    }
  }
  
  if (w.temp !== null) {
    if (w.temp >= 35) {
      const key = `heat_${today}`;
      if (!alertCache[key]) {
        alertCache[key] = Date.now();
        alerts.push({
          emoji: "🔥",
          title: "Сильна спека!",
          text: `🌡 ${Math.round(w.temp)}°C (відчувається ${Math.round(w.feels || w.temp)}°)`
        });
      }
    }
    if (w.temp <= -15) {
      const key = `cold_${today}`;
      if (!alertCache[key]) {
        alertCache[key] = Date.now();
        alerts.push({
          emoji: "🥶",
          title: "Сильний мороз!",
          text: `🌡 ${Math.round(w.temp)}°C (відчувається ${Math.round(w.feels || w.temp)}°)`
        });
      }
    }
  }
  
  return { current: w, forecast: f, alerts, now };
}

// ============================================
// 6. ОБРОБНИКИ
// ============================================

async function handleWeather(chatId) {
  if (!LOCATION) {
    await send(chatId, "📍 Не вказана локація. Надішліть геолокацію або додайте LATITUDE/LONGITUDE в змінні.");
    return;
  }
  
  try {
    const { current: w, now } = await checkWeather(LOCATION.lat, LOCATION.lon);
    
    let text = `${weatherEmoji(w.precip)} <b>${LOCATION.name}</b>\n\n`;
    text += `🌡 <b>${Math.round(w.temp)}°C</b> (відчувається ${Math.round(w.feels || w.temp)}°)\n`;
    text += `💧 Вологість: ${w.humid}%\n`;
    text += `💨 Вітер: ${Math.round(w.wind || 0)} км/год`;
    if (w.dir) text += ` ${w.dir}`;
    if (w.gust && w.gust > w.wind * 1.3) text += ` (пориви до ${Math.round(w.gust)} км/год)`;
    text += `\n`;
    text += `☁️ ${w.cond || '—'}\n`;
    text += `📊 Дощ: ${Math.round(w.precip)}%`;
    if (w.qpf > 0.1) text += ` (${w.qpf.toFixed(1)} мм)`;
    text += `\n🕐 ${now}`;
    
    await send(chatId, text);
  } catch (e) {
    await send(chatId, `❌ Помилка: ${e.message}`);
  }
}

async function handleForecast(chatId) {
  if (!LOCATION) {
    await send(chatId, "📍 Не вказана локація.");
    return;
  }
  
  try {
    const f = await getForecast(LOCATION.lat, LOCATION.lon, 3);
    let text = `📅 <b>Прогноз: ${LOCATION.name}</b>\n`;
    for (const d of f) {
      const emoji = weatherEmoji(d.precip);
      text += `\n${emoji} <b>${fmtDate(d.date)}</b>\n`;
      text += `🌡 ${Math.round(d.min || 0)}° — ${Math.round(d.max || 0)}°\n`;
      text += `💨 ${Math.round(d.wind || 0)} км/год`;
      if (d.dir) text += ` ${d.dir}`;
      text += `\n💧 ${Math.round(d.precip)}%`;
      if (d.qpf > 0.1) text += ` (${d.qpf.toFixed(1)} мм)`;
      if (d.cond) text += `\n☁️ ${d.cond}`;
    }
    await send(chatId, text);
  } catch (e) {
    await send(chatId, `❌ Помилка: ${e.message}`);
  }
}

async function handleAlerts(chatId) {
  if (!LOCATION) {
    await send(chatId, "📍 Не вказана локація.");
    return;
  }
  
  try {
    const { alerts } = await checkWeather(LOCATION.lat, LOCATION.lon);
    
    if (alerts.length === 0) {
      await send(chatId, `✅ Все спокійно. Небезпечних умов не виявлено.\n🕐 ${fmtTime()}`);
    } else {
      let text = `⚠️ <b>ПОПЕРЕДЖЕННЯ</b>\n📍 ${LOCATION.name}\n\n`;
      for (const a of alerts) {
        text += `${a.emoji} <b>${a.title}</b>\n${a.text}\n\n`;
      }
      text += `🕐 ${fmtTime()}`;
      await send(chatId, text);
    }
  } catch (e) {
    await send(chatId, `❌ Помилка: ${e.message}`);
  }
}

// ============================================
// 7. ОБРОБНИК ПОВІДОМЛЕНЬ
// ============================================

async function handleMessage(message) {
  const chatId = message.chat?.id;
  if (!chatId) return;
  
  await initDB();
  await saveChatIdToDb(chatId);
  
  if (!MY_CHAT_ID) {
    const dbChat = await loadChatIdFromDb();
    if (dbChat) MY_CHAT_ID = dbChat;
  }
  
  if (chatId !== MY_CHAT_ID) {
    await send(chatId, "⛔ Цей бот тільки для власника.");
    return;
  }
  
  const text = message.text || "";
  const location = message.location;
  
  if (location) {
    await saveLocationToDb(location.latitude, location.longitude, `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`);
    LOCATION = {
      name: `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`,
      lat: location.latitude,
      lon: location.longitude
    };
    await send(chatId, `✅ Локацію оновлено: ${LOCATION.name}`);
    await handleWeather(chatId);
    return;
  }
  
  const cmd = text.trim().toLowerCase();
  if (cmd === "/start" || cmd === "/help") {
    await send(chatId, `🌦 <b>WeatherNext</b>\n\nКоманди:\n/weather — погода зараз\n/forecast — прогноз на 3 дні\n/alerts — перевірити алерти\n/status — статус бота\n\n📍 Надішліть геолокацію щоб змінити місце`);
  } else if (cmd === "/weather" || cmd === "погода") {
    await handleWeather(chatId);
  } else if (cmd === "/forecast" || cmd === "прогноз") {
    await handleForecast(chatId);
  } else if (cmd === "/alerts" || cmd === "алерти") {
    await handleAlerts(chatId);
  } else if (cmd === "/status") {
    const locText = LOCATION ? `${LOCATION.name} (${LOCATION.lat}, ${LOCATION.lon})` : "❌ не встановлено";
    await send(chatId, `📊 <b>Статус бота</b>\n\n📍 Локація: ${locText}\n👤 Ваш ID: ${chatId}\n🕐 ${fmtTime()}`);
  } else if (cmd.startsWith("/setloc")) {
    const parts = text.split(" ");
    if (parts.length >= 2) {
      const name = parts.slice(1).join(" ");
      if (LOCATION) {
        LOCATION.name = name;
        await send(chatId, `✅ Назву локації змінено на: ${name}`);
      }
    }
  } else if (cmd) {
    await handleWeather(chatId);
  }
}

// ============================================
// 8. CRON ЗАПУСК
// ============================================

async function loadLocation() {
  if (ENV.LATITUDE && ENV.LONGITUDE) {
    LOCATION = {
      name: ENV.LOCATION_NAME || "Моя локація",
      lat: parseFloat(ENV.LATITUDE),
      lon: parseFloat(ENV.LONGITUDE)
    };
    return LOCATION;
  }
  const dbLoc = await loadLocationFromDb();
  if (dbLoc) {
    LOCATION = dbLoc;
  } else {
    LOCATION = null;
  }
  return LOCATION;
}

async function runCron() {
  cleanCache();
  await initDB();
  await loadLocation();
  if (!MY_CHAT_ID) {
    const dbChat = await loadChatIdFromDb();
    if (dbChat) MY_CHAT_ID = dbChat;
  }
  if (!MY_CHAT_ID) return { error: "no chat id" };
  if (!LOCATION) return { error: "no location" };
  
  try {
    const { alerts } = await checkWeather(LOCATION.lat, LOCATION.lon);
    if (alerts.length > 0) {
      let text = `⚠️ <b>ПОПЕРЕДЖЕННЯ</b>\n📍 ${LOCATION.name}\n\n`;
      for (const a of alerts) {
        text += `${a.emoji} <b>${a.title}</b>\n${a.text}\n\n`;
      }
      text += `🕐 ${fmtTime()}`;
      await send(MY_CHAT_ID, text);
    }
    return { alerts: alerts.length };
  } catch (e) {
    console.error("[cron] Error:", e.message);
    return { error: e.message };
  }
}

// ============================================
// 9. ENTRY POINT
// ============================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    configure(env);
    await initDB();
    await loadLocation();
    
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(JSON.stringify({ 
        status: "ok", 
        bot: "wn3-mini",
        location: LOCATION ? "set" : "not set"
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    if (url.pathname === "/webhook" && request.method === "POST") {
      try {
        const update = await request.json();
        if (update.message) {
          ctx.waitUntil(handleMessage(update.message));
        }
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
    
    return new Response(JSON.stringify({ ok: false, error: "not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  },
  
  async scheduled(event, env, ctx) {
    configure(env);
    if (MY_CHAT_ID && LOCATION) {
      await runCron();
    }
  }
};
