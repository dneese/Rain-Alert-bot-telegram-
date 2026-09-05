import zlib from 'node:zlib';
import { initDB, configureDb, getUser, saveUser, getAllUsers, getUserApiKey, getAllUserApiKeys, saveUserApiKey, deleteUserApiKey, getUserSettings, saveUserSettings, getUserLocations, getDefaultLocation, addUserLocation, setDefaultLocation, deleteUserLocation, updateUserLocationState } from './lib/db.js';
import { t, getLangName, getLangFlag, languagePages } from './lib/i18n.js';
import { interceptRainCell, cloudMotionFromWind } from './lib/vector-intercept.js';

// === Environment (injected by the Worker bootstrap via configure()) ===
let ENV = {};
export function configure(env) {
  ENV = env || {};
  BOT_TOKEN = ENV.TELEGRAM_BOT_TOKEN || ENV.BOT_TOKEN || '';
  WEATHERAPI_KEY = ENV.WEATHERAPI_KEY || '';
  OWM_KEY = ENV.OWM_KEY || '';
  RAINBOW_KEY = ENV.RAINBOW_KEY || '';
  if (configureDb) configureDb(ENV);
}

let BOT_TOKEN = '';
let WEATHERAPI_KEY = '';
let OWM_KEY = '';
let RAINBOW_KEY = '';

// === Telegram API ===
async function tgApi(method, body = {}) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function tgSendMessage(chatId, text, options = {}) {
  return tgApi('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...options });
}

async function tgEditMessage(chatId, messageId, text, options = {}) {
  return tgApi('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', ...options });
}

async function tgAnswerCallback(callbackQueryId, text = '', showAlert = false) {
  return tgApi('answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: showAlert });
}

async function tgSetWebhook(url) {
  return tgApi('setWebhook', { url, allowed_updates: ['message', 'callback_query'] });
}

// === Rich Message helpers (Bot API 10.1+) with plain-HTML fallback ===
// InputRichMessage contract: rich_message must be { html } or { markdown }, never both.
let richEnabled = true; // latched off on permanent capability errors
async function tgSendRichMessage(chatId, html, options = {}) {
  return tgApi('sendRichMessage', { chat_id: chatId, rich_message: { html }, ...options });
}

async function tgEditRichMessage(chatId, messageId, html, options = {}) {
  return tgApi('editMessageText', { chat_id: chatId, message_id: messageId, rich_message: { html }, ...options });
}

async function sendWithFallback(chatId, richHtml, options = {}, plainHtml = null) {
  if (richEnabled) {
    try {
      const r = await tgSendRichMessage(chatId, richHtml, options);
      if (r?.ok) return r;
      if (r && r.error_code === 404) richEnabled = false; // endpoint not available
    } catch (e) {}
  }
  return tgSendMessage(chatId, plainHtml || richHtml, options);
}

async function editWithFallback(chatId, messageId, richHtml, options = {}, plainHtml = null) {
  if (richEnabled) {
    try {
      const r = await tgEditRichMessage(chatId, messageId, richHtml, options);
      if (r?.ok) return r;
      if (r && r.error_code === 404) richEnabled = false; // endpoint not available
    } catch (e) {}
  }
  return tgEditMessage(chatId, messageId, plainHtml || richHtml, options);
}

// === Keyboards ===
const SUPPORTED_LANGS = ['uk', 'en', 'ru', 'pl', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'cs', 'sk', 'ro', 'hu', 'bg', 'hr', 'tr', 'ar', 'he', 'zh', 'ja', 'ko'];

function mainMenuKeyboard(lang) {
  return {
    inline_keyboard: [
      [
        { text: t(lang, 'btn_location'), callback_data: 'cb_location' },
        { text: t(lang, 'btn_check'), callback_data: 'cb_check' },
      ],
      [
        { text: `↻ ${t(lang, 'btn_refresh')}`, callback_data: 'cb_update' },
      ],
      [
        { text: t(lang, 'btn_settings'), callback_data: 'cb_settings' },
      ],
    ],
  };
}

function settingsKeyboard(lang) {
  return {
    inline_keyboard: [
      [
        { text: t(lang, 'api_keys_label'), callback_data: 'cb_api_keys' },
        { text: t(lang, 'language_label'), callback_data: 'cb_lang' },
      ],
      [
        { text: t(lang, 'btn_back'), callback_data: 'cb_back_main' },
      ],
    ],
  };
}

function apiKeysKeyboard(lang, activeKeys) {
  const providers = [
    // Only OpenWeatherMap is used as the user-supplied supplementary source.
    // WeatherAPI and Rainbow were disabled (both in checks and here in the UI).
    { key: 'owm', label: 'OpenWeatherMap' },
  ];
  const rows = providers.map(p => {
    const isActive = activeKeys.includes(p.key);
    return [
      { text: `${p.label} ${isActive ? '✅' : '❌'}`, callback_data: `cb_toggle_key_${p.key}` },
    ];
  });
  rows.push([{ text: t(lang, 'btn_back'), callback_data: 'cb_settings' }]);
  return { inline_keyboard: rows };
}

function languageKeyboard(page = 0, lang = 'uk') {
  const perPage = 9;
  const start = page * perPage;
  const pageLangs = languagePages.slice(start, start + perPage);
  const totalPages = Math.ceil(languagePages.length / perPage);

  const rows = [];
  for (let i = 0; i < pageLangs.length; i += 3) {
    const row = pageLangs.slice(i, i + 3).map(code => ({
      text: `${getLangFlag(code)} ${getLangName(code)}`,
      callback_data: `cb_lang_${code}`,
    }));
    rows.push(row);
  }

  const navRow = [];
  if (page > 0) navRow.push({ text: '◀', callback_data: `cb_lang_page_${page - 1}` });
  navRow.push({ text: `${page + 1}/${totalPages}`, callback_data: 'noop' });
  if (page < totalPages - 1) navRow.push({ text: '▶', callback_data: `cb_lang_page_${page + 1}` });
  rows.push(navRow);

  rows.push([{ text: t(lang, 'btn_back'), callback_data: 'cb_settings' }]);
  return { inline_keyboard: rows };
}

function confirmKeyKeyboard(lang, provider) {
  return {
    inline_keyboard: [
      [{ text: t(lang, 'btn_cancel'), callback_data: 'cb_api_keys' }],
    ],
  };
}

function settingsDetailKeyboard(lang, settings) {
  const s = settings || {};
  return {
    inline_keyboard: [
      [
        { text: `🌧 ${t(lang, 'set_rain_threshold')}: ${s.rain_threshold_mm || 0.5}${t(lang, 'unit_mm')}`, callback_data: 'cb_settings_threshold' },
      ],
      [
        { text: `⏱ ${t(lang, 'set_lookahead')}: ${s.lookahead_min || 30}${t(lang, 'unit_min')}`, callback_data: 'cb_settings_lookahead' },
      ],
      [
        { text: `🧪 ${t(lang, 'exp_trajectory')}: ${s.exp_trajectory === true ? '✅' : '❌'}`, callback_data: 'cb_settings_exp' },
      ],
      [
        { text: `🎯 ${t(lang, 'exp_radius')}: ${s.exp_radius_km || 10} ${t(lang, 'unit_km')}`, callback_data: 'cb_settings_exp_radius' },
      ],
      [
        { text: `⏰ ${t(lang, 'set_cooldown')}: ${s.alert_cooldown_min || 30}${t(lang, 'unit_min')}`, callback_data: 'cb_settings_cooldown' },
      ],
      [
        { text: `${s.posture === 'outside' ? '🚶' : '🏠'} ${t(lang, 'set_mode')}: ${s.posture === 'outside' ? t(lang, 'mode_outside') : t(lang, 'mode_inside')}`, callback_data: 'cb_settings_posture' },
      ],
      [
        { text: `🔧 ${t(lang, 'set_advanced') || 'Розширені'}`, callback_data: 'cb_adv_settings' },
      ],
      [
        { text: t(lang, 'api_keys_label'), callback_data: 'cb_api_keys' },
        { text: t(lang, 'language_label'), callback_data: 'cb_lang' },
      ],
      [
        { text: t(lang, 'btn_back'), callback_data: 'cb_back_main' },
      ],
    ],
  };
}

function thresholdKeyboard(lang) {
  const thresholds = [0.1, 0.3, 0.5, 1.0, 2.0];
  return {
    inline_keyboard: [
      thresholds.map(v => ({ text: `${v}мм`, callback_data: `cb_set_threshold_${v}` })),
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_settings_detail' }],
    ],
  };
}

function lookaheadKeyboard(lang) {
  const options = [15, 30, 60, 120];
  return {
    inline_keyboard: [
      options.map(v => ({ text: `${v}хв`, callback_data: `cb_set_lookahead_${v}` })),
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_settings_detail' }],
    ],
  };
}

function cooldownKeyboard(lang) {
  const options = [10, 15, 30, 60];
  return {
    inline_keyboard: [
      options.map(v => ({ text: `${v}хв`, callback_data: `cb_set_cooldown_${v}` })),
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_settings_detail' }],
    ],
  };
}

function advancedSettingsKeyboard(lang, settings) {
  const s = settings || {};
  const qhOn = s.quiet_hours_start && s.quiet_hours_end;
  const windOn = s.wind_threshold_kmh != null;
  const humOn = s.humidity_threshold_pct != null;
  const tempOn = s.temp_threshold_c != null;
  const earlyWarnH = s.early_warn_hours ? Number(s.early_warn_hours) : 0;
  return {
    inline_keyboard: [
      [{ text: `🔔 ${t(lang, 'set_early_warn')}: ${earlyWarnH ? t(lang, 'early_warn_hours', { hours: earlyWarnH }) : t(lang, 'off')}`, callback_data: 'cb_adv_earlywarn' }],
      [{ text: `🔕 ${t(lang, 'set_quiet_hours')}: ${qhOn ? s.quiet_hours_start + '-' + s.quiet_hours_end : t(lang, 'off')}`, callback_data: 'cb_adv_quiet' }],
      [{ text: `💨 ${t(lang, 'set_wind_threshold')}: ${windOn ? '>'+s.wind_threshold_kmh+'км/год' : t(lang, 'off')}`, callback_data: 'cb_adv_wind' }],
      [{ text: `💧 ${t(lang, 'set_humidity_threshold')}: ${humOn ? '>'+s.humidity_threshold_pct+'%' : t(lang, 'off')}`, callback_data: 'cb_adv_humidity' }],
      [{ text: `🌡 ${t(lang, 'set_temp_threshold')}: ${tempOn ? '<'+s.temp_threshold_c+'°C' : t(lang, 'off')}`, callback_data: 'cb_adv_temp' }],
      [{ text: `🌩 ${t(lang, 'set_rain_levels')}`, callback_data: 'cb_adv_rain_levels' }],
      [{ text: `📊 ${t(lang, 'set_sections')}`, callback_data: 'cb_adv_sections' }],
      [{ text: `📍 ${t(lang, 'set_locations')}`, callback_data: 'cb_adv_locations' }],
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_settings_detail' }],
    ],
  };
}

function quietHoursKeyboard(lang) {
  const hours = [];
  for (let h = 0; h < 24; h += 2) {
    hours.push({ text: `${h.toString().padStart(2,'0')}:00`, callback_data: `cb_qh_start_${h}` });
  }
  return {
    inline_keyboard: [
      hours.slice(0, 6),
      hours.slice(6, 12),
      [{ text: t(lang, 'btn_disable'), callback_data: 'cb_qh_off' }],
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_adv_settings' }],
    ],
  };
}

function quietHoursEndKeyboard(lang, startHour) {
  const hours = [];
  for (let h = 0; h < 24; h += 2) {
    hours.push({ text: `${h.toString().padStart(2,'0')}:00`, callback_data: `cb_qh_end_${startHour}_${h}` });
  }
  return {
    inline_keyboard: [
      hours.slice(0, 6),
      hours.slice(6, 12),
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_adv_quiet' }],
    ],
  };
}

function windThresholdKeyboard(lang) {
  const options = [10, 15, 20, 30, 40, 50];
  return {
    inline_keyboard: [
      options.map(v => ({ text: `>${v}`, callback_data: `cb_set_wind_${v}` })),
      [{ text: t(lang, 'btn_disable'), callback_data: 'cb_set_wind_0' }],
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_adv_settings' }],
    ],
  };
}

function humidityThresholdKeyboard(lang) {
  const options = [60, 70, 75, 80, 85, 90];
  return {
    inline_keyboard: [
      options.map(v => ({ text: `>${v}%`, callback_data: `cb_set_hum_${v}` })),
      [{ text: t(lang, 'btn_disable'), callback_data: 'cb_set_hum_0' }],
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_adv_settings' }],
    ],
  };
}

function tempThresholdKeyboard(lang) {
  const options = [0, 5, 10, 15, 20, 25, 30];
  return {
    inline_keyboard: [
      options.map(v => ({ text: `<${v}°C`, callback_data: `cb_set_temp_${v}` })),
      [{ text: t(lang, 'btn_disable'), callback_data: 'cb_set_temp_999' }],
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_adv_settings' }],
    ],
  };
}

function earlyWarnKeyboard(lang, settings) {
  const s = settings || {};
  const options = [3, 6, 12, 24, 48];
  return {
    inline_keyboard: [
      options.map(v => ({ text: t(lang, 'early_warn_hours', { hours: v }), callback_data: `cb_set_earlywarn_${v}` })),
      [{ text: t(lang, 'btn_disable'), callback_data: 'cb_set_earlywarn_0' }],
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_adv_settings' }],
    ],
  };
}

function rainLevelsKeyboard(lang, settings) {
  const s = settings || {};
  return {
    inline_keyboard: [
      [{ text: `🌦 Мряка: ${s.alert_drizzle !== false ? '✅' : '❌'}`, callback_data: 'cb_toggle_drizzle' }],
      [{ text: `🌧 Легкий дощ: ${s.alert_light_rain !== false ? '✅' : '❌'}`, callback_data: 'cb_toggle_light_rain' }],
      [{ text: `🌧 Сильний дощ: ${s.alert_heavy_rain !== false ? '✅' : '❌'}`, callback_data: 'cb_toggle_heavy_rain' }],
      [{ text: `⛈ Гроза: ${s.alert_thunderstorm !== false ? '✅' : '❌'}`, callback_data: 'cb_toggle_thunderstorm' }],
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_adv_settings' }],
    ],
  };
}

function sectionsKeyboard(lang, settings) {
  const s = settings || {};
  return {
    inline_keyboard: [
      [{ text: `📸 Поточна: ${s.show_current !== false ? '✅' : '❌'}`, callback_data: 'cb_toggle_current' }],
      [{ text: `📅 Годинний: ${s.show_hourly !== false ? '✅' : '❌'}`, callback_data: 'cb_toggle_hourly' }],
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_adv_settings' }],
    ],
  };
}

function locationsKeyboard(lang, locations) {
  const rows = locations.map(loc => ([
    { text: `${loc.is_default ? '⭐' : '📍'} ${loc.name} (${loc.latitude.toFixed(2)}, ${loc.longitude.toFixed(2)})`, callback_data: `cb_loc_default_${loc.id}` },
    { text: '🗑', callback_data: `cb_loc_delete_${loc.id}` },
  ]));
  rows.push([{ text: t(lang, 'btn_add_location'), callback_data: 'cb_loc_add' }]);
  rows.push([{ text: t(lang, 'btn_back'), callback_data: 'cb_adv_settings' }]);
  return { inline_keyboard: rows };
}

// === Weather APIs ===

// WMO Weather interpretation codes
const WMO_CODES = {
  0: { desc: 'Clear', icon: '☀️', rain: false },
  1: { desc: 'Mainly clear', icon: '🌤', rain: false },
  2: { desc: 'Partly cloudy', icon: '⛅', rain: false },
  3: { desc: 'Overcast', icon: '☁️', rain: false },
  45: { desc: 'Fog', icon: '🌫', rain: false },
  48: { desc: 'Rime fog', icon: '🌫', rain: false },
  51: { desc: 'Light drizzle', icon: '🌦', rain: true },
  53: { desc: 'Moderate drizzle', icon: '🌦', rain: true },
  55: { desc: 'Dense drizzle', icon: '🌧', rain: true },
  56: { desc: 'Freezing drizzle', icon: '🌧', rain: true },
  57: { desc: 'Heavy freezing drizzle', icon: '🌧', rain: true },
  61: { desc: 'Slight rain', icon: '🌦', rain: true },
  63: { desc: 'Moderate rain', icon: '🌧', rain: true },
  65: { desc: 'Heavy rain', icon: '🌧', rain: true },
  66: { desc: 'Freezing rain', icon: '🌧', rain: true },
  67: { desc: 'Heavy freezing rain', icon: '🌧', rain: true },
  71: { desc: 'Slight snow', icon: '❄️', rain: true },
  73: { desc: 'Moderate snow', icon: '❄️', rain: true },
  75: { desc: 'Heavy snow', icon: '❄️', rain: true, severe: true },
  77: { desc: 'Snow grains', icon: '❄️', rain: true },
  80: { desc: 'Slight showers', icon: '🌦', rain: true },
  81: { desc: 'Moderate showers', icon: '🌧', rain: true },
  82: { desc: 'Violent showers', icon: '🌧', rain: true, severe: true },
  85: { desc: 'Slight snow showers', icon: '🌨', rain: true },
  86: { desc: 'Heavy snow showers', icon: '🌨', rain: true, severe: true },
  95: { desc: 'Thunderstorm', icon: '⛈', rain: true, severe: true },
  96: { desc: 'Thunderstorm with hail', icon: '⛈', rain: true, severe: true },
  99: { desc: 'Thunderstorm with heavy hail', icon: '⛈', rain: true, severe: true },
};

// Open-Meteo: current + minutely_15 + hourly in ONE call
async function fetchOpenMeteoFull(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m&minutely_15=precipitation,precipitation_probability&hourly=precipitation_probability,precipitation,temperature_2m,wind_speed_10m,weather_code&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&forecast_days=3`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo: ${res.status}`);
  const data = await res.json();
  const tzOffsetSec = data.utc_offset_seconds || 0;

  // Convert API time string (in local tz) to real UTC epoch
  function apiTimeToMs(timeStr) {
    if (!timeStr) return 0;
    const d = new Date(timeStr + 'Z');
    return d.getTime() - tzOffsetSec * 1000;
  }

  // "Now" in real UTC
  const nowLocalMs = Date.now();

  const current = {
    temp_c: data.current.temperature_2m,
    humidity: data.current.relative_humidity_2m,
    precipitation_mm: data.current.precipitation,
    rain_mm: data.current.rain,
    weather_code: data.current.weather_code,
    wind_speed: data.current.wind_speed_10m,
    time: data.current.time,
    is_raining: WMO_CODES[data.current.weather_code]?.rain || data.current.precipitation > 0,
    weather_icon: WMO_CODES[data.current.weather_code]?.icon || '🌤',
    weather_desc: WMO_CODES[data.current.weather_code]?.desc || 'Unknown',
  };

  const minutely = (data.minutely_15?.time || [])
    .map((t, i) => ({
      timeStr: t,
      ms: apiTimeToMs(t),
      precip_mm: data.minutely_15.precipitation[i],
      probability: data.minutely_15.precipitation_probability[i],
    }))
    .filter(h => h.ms >= nowLocalMs - 15 * 60 * 1000);

  const hourly = (data.hourly?.time || [])
    .map((t, i) => ({
      timeStr: t,
      ms: apiTimeToMs(t),
      probability: data.hourly.precipitation_probability[i],
      precip_mm: data.hourly.precipitation[i],
      temp_c: data.hourly.temperature_2m[i],
      wind_speed: data.hourly.wind_speed_10m[i],
      wmo_code: data.hourly.weather_code[i],
    }))
    .filter(h => h.ms >= nowLocalMs);

  const daily = data.daily ? {
    sunrise: data.daily.sunrise?.[0] || null,
    sunset: data.daily.sunset?.[0] || null,
    tmax: data.daily.temperature_2m_max?.[0] ?? null,
    tmin: data.daily.temperature_2m_min?.[0] ?? null,
    precip_sum: data.daily.precipitation_sum?.[0] ?? 0,
  } : null;

  return { current, minutely, hourly, daily, timezone: data.timezone, tzOffsetMs: tzOffsetSec * 1000, nowLocalMs };
}

// Lightweight timezone resolver for fallback sources.
// Open-Meteo forecast may occasionally fail while its /v1/forecast (timezone-only)
// call still works; we use it to get a correct utc_offset_seconds so that
// fallback providers (MET Norway, etc.) can display LOCAL time instead of UTC.
const tzCache = new Map();
async function getTzOffsetSec(lat, lon) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (tzCache.has(key)) return tzCache.get(key);
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m&timezone=auto&forecast_days=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      const offset = data.utc_offset_seconds || 0;
      tzCache.set(key, offset);
      return offset;
    }
  } catch (e) {}
  // Fallback estimate by longitude: ~1h per 15° (no DST correction, best-effort)
  const est = Math.round(lon / 15) * 3600;
  tzCache.set(key, est);
  return est;
}

// Open-Meteo Air Quality API: European AQI + UV index (+ pollen for Europe)
// Separate endpoint = separate free quota (10k/day), doesn't touch forecast limits
// MET Norway (api.met.no): free fallback source, no key needed, requires User-Agent.
// Used only when Open-Meteo is down. Display times are UTC in this degraded mode;
// alert logic stays correct because ms epochs are real UTC.
async function fetchMetNorway(lat, lon) {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'RainAlertBot/1.0 github.com/dneese/rain-alert-bot' } });
  if (!res.ok) throw new Error(`MET Norway: ${res.status}`);
  const d = await res.json();
  const series = d.properties?.timeseries || [];
  if (!series.length) throw new Error('MET Norway: empty timeseries');
  const now = Date.now();

  let first = series[0];
  for (const s of series) {
    if (new Date(s.time).getTime() >= now - 30 * 60 * 1000) { first = s; break; }
  }
  const inst = first.data?.instant?.details || {};
  const next1 = first.data?.next_1_hours?.details || {};
  const current = {
    temp_c: inst.air_temperature ?? null,
    humidity: inst.relative_humidity ?? null,
    precipitation_mm: next1.precipitation_amount ?? 0,
    wind_speed: inst.wind_speed != null ? inst.wind_speed * 3.6 : null,
    weather_code: null,
    is_raining: (next1.precipitation_amount ?? 0) > 0.1,
    weather_icon: '🌧',
  };

  const pad = n => String(n).padStart(2, '0');
  const hourly = series
    .filter(s => new Date(s.time).getTime() >= now)
    .slice(0, 12)
    .map(s => {
      const dt = new Date(s.time);
      const n1h = s.data?.next_1_hours?.details || {};
      return {
        timeStr: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`,
        ms: dt.getTime(),
        probability: null,
        precip_mm: n1h.precipitation_amount ?? 0,
        temp_c: s.data?.instant?.details?.air_temperature ?? null,
        wmo_code: null,
      };
    });

  return { current, hourly };
}

// RainViewer: real-time radar precipitation
async function fetchRainViewer(lat, lon) {
  const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
  if (!res.ok) throw new Error(`RainViewer: ${res.status}`);
  const data = await res.json();
  const pastFrames = data.radar?.past || [];
  if (pastFrames.length === 0) return { is_raining: false, intensity: 0 };

  const lastFrame = pastFrames[pastFrames.length - 1];
  const frameTime = lastFrame.time * 1000;
  const ageMinutes = (Date.now() - frameTime) / (1000 * 60);

  if (ageMinutes > 30) return { is_raining: false, intensity: 0, stale: true };

  const zoom = 10;
  const latRad = lat * Math.PI / 180;
  const n = Math.pow(2, zoom);
  const x = Math.floor((lon + 180) / 360 * n);
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);

  const tileUrl = `https://tilecache.rainviewer.com${lastFrame.path}/${zoom}/${x}/${y}/6/1_1.png`;
  const tileRes = await fetch(tileUrl);
  if (!tileRes.ok) return { is_raining: false, intensity: 0 };

  const buf = Buffer.from(await tileRes.arrayBuffer());
  const intensity = parseRadarTile(buf);
  return { is_raining: intensity > 0, intensity, ageMinutes: Math.round(ageMinutes) };
}

function parseRadarTile(pngBuf) {
  try {
    const w = pngBuf.readUInt32BE(16);
    const h = pngBuf.readUInt32BE(20);

    let pos = 8;
    let palette = null;
    let idatData = Buffer.alloc(0);
    while (pos < pngBuf.length) {
      const len = pngBuf.readUInt32BE(pos);
      const type = pngBuf.slice(pos + 4, pos + 8).toString('ascii');
      if (type === 'PLTE') {
        palette = [];
        const plteData = pngBuf.slice(pos + 8, pos + 8 + len);
        for (let i = 0; i < plteData.length; i += 3) {
          palette.push({ r: plteData[i], g: plteData[i + 1], b: plteData[i + 2], a: 255 });
        }
      }
      if (type === 'tRNS') {
        const trnsData = pngBuf.slice(pos + 8, pos + 8 + len);
        if (palette) {
          for (let i = 0; i < trnsData.length && i < palette.length; i++) {
            palette[i].a = trnsData[i];
          }
        }
      }
      if (type === 'IDAT') {
        idatData = Buffer.concat([idatData, pngBuf.slice(pos + 8, pos + 8 + len)]);
      }
      if (type === 'IEND') break;
      pos += 12 + len;
    }

    if (!palette || idatData.length === 0) return 0;

    const raw = zlib.inflateSync(idatData);
    const rowBytes = 1 + w;
    let rainPixels = 0;
    let totalPixels = 0;
    let maxIntensity = 0;

    for (let py = 0; py < h; py++) {
      const rowStart = py * rowBytes + 1;
      for (let px = 0; px < w; px++) {
        const idx = raw[rowStart + px];
        const color = palette[idx];
        if (color && color.a > 10) {
          rainPixels++;
          const brightness = (color.r + color.g + color.b) / 3;
          if (brightness < 50) maxIntensity = Math.max(maxIntensity, 5);
          else if (brightness < 100) maxIntensity = Math.max(maxIntensity, 4);
          else if (brightness < 150) maxIntensity = Math.max(maxIntensity, 3);
          else if (brightness < 200) maxIntensity = Math.max(maxIntensity, 2);
          else maxIntensity = Math.max(maxIntensity, 1);
        }
        totalPixels++;
      }
    }

    const coverage = rainPixels / totalPixels;
    if (coverage < 0.01) return 0;
    if (coverage < 0.05) return 1;
    if (coverage < 0.15) return 2;
    if (coverage < 0.30) return 3;
    if (coverage < 0.50) return 4;
    return 5;
  } catch (e) {
    console.warn('Radar parse error:', e.message);
    return 0;
  }
}

async function fetchWeatherAPI(lat, lon, apiKey) {
  const key = apiKey || WEATHERAPI_KEY;
  if (!key) return null;
  const url = `https://api.weatherapi.com/v1/forecast.json?key=${key}&q=${lat},${lon}&days=2&alerts=yes`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`WeatherAPI: ${res.status}`);
  const data = await res.json();
  const hours = data.forecast.forecastday.flatMap(d => d.hour);
  const now = new Date();
  return hours
    .filter(h => new Date(h.time) >= now)
    .map(h => ({
      time: h.time,
      probability: h.chance_of_rain,
      precip_mm: h.precip_mm,
      temp_c: h.temp_c,
      humidity: h.humidity,
      wind_kph: h.wind_kph,
    }));
}

// Translate an OWM weather id to the nearest WMO weather code so the shared
// card/severe-warning logic (WMO_CODES) works with OWM as the single source.
function owmToWmo(id) {
  if (id == null) return null;
  if (id >= 200 && id < 300) return 95;          // thunderstorm
  if (id >= 300 && id < 400) return 53;          // drizzle
  if (id >= 500 && id < 600) {                   // rain
    if (id === 500) return 61;
    if (id === 501) return 63;
    if (id === 511) return 67;
    return 65;
  }
  if (id >= 600 && id < 700) {                   // snow
    if (id === 600) return 71;
    if (id === 601) return 73;
    return 75;
  }
  if (id >= 700 && id < 800) return 45;          // atmosphere/mist/fog
  if (id === 800) return 0;                      // clear
  if (id === 801) return 1;
  if (id === 802) return 2;
  if (id === 803) return 3;
  return 3;                                      // 804 overcast
}

// OWM current observation (/data/2.5/weather) — the authoritative "is it
// raining right now" signal. The 3h forecast API can say dry while a band of
// rain is already overhead, so we treat current precip as decisive.
async function fetchOWMCurrent(lat, lon, apiKey) {
  const key = apiKey || OWM_KEY;
  if (!key) return null;
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OWM current: ${res.status}`);
  const d = await res.json();
  const rain1h = d.rain && typeof d.rain['1h'] === 'number' ? d.rain['1h'] : 0;
  const snow1h = d.snow && typeof d.snow['1h'] === 'number' ? d.snow['1h'] : 0;
  const id = d.weather?.[0]?.id ?? null;
  const wmo = owmToWmo(id);
  // 2xx thunder, 3xx drizzle, 5xx rain, 6xx snow — precipitation now
  const codeRain = id != null && id < 700 && id % 100 !== 0 && Math.floor(id / 100) >= 2;
  return {
    ms: d.dt ? d.dt * 1000 : Date.now(),
    tzOffsetMs: typeof d.timezone === 'number' ? d.timezone * 1000 : null,
    rain_mm: rain1h,
    snow_mm: snow1h,
    precip_mm: rain1h + snow1h,
    weather_id: id,
    weather_code: wmo,
    weather_icon: WMO_CODES[wmo]?.icon || '🌤',
    weather_desc: d.weather?.[0]?.description || '',
    desc: d.weather?.[0]?.description || '',
    temp_c: d.main?.temp ?? null,
    humidity: d.main?.humidity ?? null,
    wind_kph: d.wind?.speed ? d.wind.speed * 3.6 : null,
    wind_deg: d.wind?.deg ?? null,
    is_raining: (rain1h + snow1h) > 0.2 || (codeRain && (rain1h + snow1h) > 0.05),
  };
}

async function fetchOWM(lat, lon, apiKey) {
  const key = apiKey || OWM_KEY;
  if (!key) return null;
  const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OWM: ${res.status}`);
  const data = await res.json();
  const now = Date.now();
  const tzOffsetMs = typeof data.city?.timezone === 'number' ? data.city.timezone * 1000 : null;
  const list = (data.list || [])
    .filter(item => item.dt * 1000 >= now - 3600000)
    .map(item => {
      const wid = item.weather?.[0]?.id ?? null;
      const wmo = owmToWmo(wid);
      return {
        time: new Date(item.dt * 1000).toISOString().replace('.000Z', ''),
        ms: item.dt * 1000,
        probability: Math.round((item.pop || 0) * 100),
        precip_mm: item.rain?.['3h'] ? item.rain['3h'] / 3 : (item.snow?.['3h'] ? item.snow['3h'] / 3 : 0),
        temp_c: item.main?.temp ?? null,
        humidity: item.main?.humidity ?? null,
        wind_kph: item.wind?.speed ? item.wind.speed * 3.6 : null,
        description: item.weather?.[0]?.description || '',
        weather_id: wid,
        wmo_code: wmo,
      };
    });
  return { list, tzOffsetMs };
}

// === Experimental "factual rain trajectory" ===
// Rather than trusting a forecast, we sample the *actual current* OWM weather at
// a ring of points around the user's location. If it is really raining at some of
// those points (a fact, not a prediction) and the cloud-motion vector (preferring
// the 850 hPa leading wind, falling back to surface wind) carries that cell toward
// the user, we compute the interception sector (cloud width) and the ETA. This is
// the "погода то погода, а фактичний дощ то фактичний дощ" idea implemented via
// OWM current observations instead of a radar (RainViewer returns NODATA globally).

const EXP_RING_POINTS = 8;          // points on each sampling ring
const EXP_CLOUD_RADIUS_KM = 2;      // assumed rain-cloud width (km)
const EXP_INTENSITY_MIN_MMH = 0.5;  // ignore cells below this precipitation rate (mm/h)
const EXP_POINT_CACHE_MS = 12 * 60 * 1000;
const EXP_UPPERWIND_CACHE_MS = 15 * 60 * 1000;

function destinationPoint(lat, lon, bearingDeg, distKm) {
  const R = 6371;
  const brg = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const angDist = distKm / R;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angDist) +
    Math.cos(lat1) * Math.sin(angDist) * Math.cos(brg)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(brg) * Math.sin(angDist) * Math.cos(lat1),
    Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2)
  );
  return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI };
}

function windDirName(lang, deg) {
  const names = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return t(lang, 'dir_' + names[idx]);
}

// Short-lived point cache to avoid hammering OWM during a single cron run.
// Keyed by rounded coordinates, so users who live in the same city share the
// sampled points (geo-bucketing) instead of each fetching 17 points.
const expPointCache = new Map();

async function sampleRainPoint(lat, lon, key) {
  const ck = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = expPointCache.get(ck);
  if (cached && Date.now() - cached.t < EXP_POINT_CACHE_MS) return cached.v;
  let v;
  try {
    const cur = await fetchOWMCurrent(lat, lon, key);
    v = {
      mm: cur ? cur.precip_mm : 0,
      snow_mm: cur ? cur.snow_mm : 0,
      wind_deg: cur ? cur.wind_deg : null,
      wind_kph: cur ? cur.wind_kph : null,
      temp_c: cur ? cur.temp_c : null,
      ms: cur ? cur.ms : Date.now(),
    };
  } catch (e) {
    console.warn('[EXP] sample fail:', e.message);
    v = { mm: 0, snow_mm: 0, wind_deg: null, wind_kph: null, temp_c: null, ms: Date.now() };
  }
  expPointCache.set(ck, { t: Date.now(), v });
  if (expPointCache.size > 400) expPointCache.delete(expPointCache.keys().next().value);
  return v;
}

// 850 hPa (~1.5 km, the "leading flow" that actually carries clouds) wind from
// Open-Meteo: free, no key. Cached per ~2 km geo-bucket so nearby users share it.
const upperWindCache = new Map();

function expGridKey(lat, lon) {
  return `${Math.round(lat * 50)},${Math.round(lon * 50)}`;
}

async function fetchUpperWind850(lat, lon) {
  const gk = expGridKey(lat, lon);
  const cached = upperWindCache.get(gk);
  if (cached && Date.now() - cached.t < EXP_UPPERWIND_CACHE_MS) return cached.v;
  let v = null;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=windspeed_850hPa,winddirection_850hPa&wind_speed_unit=kmh`;
    const res = await fetch(url);
    if (res.ok) {
      const d = await res.json();
      const kph = d?.current?.windspeed_850hPa;
      const fromDeg = d?.current?.winddirection_850hPa;
      if (typeof kph === 'number' && typeof fromDeg === 'number') {
        v = { kph, fromDeg: ((fromDeg % 360) + 360) % 360 };
      }
    } else {
      console.warn(`[EXP] upper wind HTTP ${res.status}`);
    }
  } catch (e) {
    console.warn('[EXP] upper wind fail:', e.message);
  }
  upperWindCache.set(gk, { t: Date.now(), v });
  if (upperWindCache.size > 200) upperWindCache.delete(upperWindCache.keys().next().value);
  return v;
}

// Cloud-motion vector: prefer the 850 hPa flow, fall back to the surface wind
// observed at the user's point.
async function getCloudMotion(lat, lon, userCur) {
  const upper = await fetchUpperWind850(lat, lon);
  if (upper && upper.kph > 0) return cloudMotionFromWind(upper.fromDeg, upper.kph);
  if (userCur.wind_deg != null && userCur.wind_kph) {
    return cloudMotionFromWind(userCur.wind_deg, userCur.wind_kph);
  }
  return null;
}

// Returns { cells, motion, userTempC } based on factual OWM samples.
// cells = [{ lat, lon, mm, snowMm }] — only cells with precipitation above the
// intensity threshold. If there is no OWM key, returns null.
async function detectRainTrajectory(lat, lon, chatId, radiusKm) {
  const owmKey = chatId ? await getUserApiKey(chatId, 'owm') : null;
  const key = owmKey || OWM_KEY;
  if (!key) return null;

  const radius = Math.max(5, Number(radiusKm) || 10);
  const userCur = await sampleRainPoint(lat, lon, key);
  const motion = await getCloudMotion(lat, lon, userCur);

  // Sample points on two rings around the user (excluding the user point itself).
  // Point count is constant regardless of the radius: 2 rings x 8 dirs + center.
  const cells = [];
  const radii = [radius * 0.4, radius * 0.85];
  for (const r of radii) {
    for (let i = 0; i < EXP_RING_POINTS; i++) {
      const bearing = (360 / EXP_RING_POINTS) * i;
      const p = destinationPoint(lat, lon, bearing, r);
      const s = await sampleRainPoint(p.lat, p.lon, key);
      if (s.mm >= EXP_INTENSITY_MIN_MMH) {
        cells.push({ lat: p.lat, lon: p.lon, mm: s.mm, snowMm: s.snow_mm });
      }
    }
  }

  return { cells, motion, userTempC: userCur.temp_c };
}

// Run the pure interception math over every detected cell and return the cell
// that will hit the user soonest (ties broken by nearest distance).
function pickBestInterception(cells, user, motion) {
  let best = null;
  for (const c of cells) {
    const hit = interceptRainCell({
      user,
      cell: { lat: c.lat, lon: c.lon, intensityMmh: c.mm },
      motion,
      opts: { cloudRadiusKm: EXP_CLOUD_RADIUS_KM },
    });
    if (hit) {
      hit.snowMm = c.snowMm > 0;
      hit.mm = c.mm;
      if (!best || hit.etaMinutes < best.etaMinutes ||
        (hit.etaMinutes === best.etaMinutes && hit.distanceKm < best.distanceKm)) {
        best = hit;
      }
    }
  }
  return best;
}

async function fetchRainbowWeather(lat, lon, apiKey) {
  const key = apiKey || RAINBOW_KEY;
  if (!key) return null;
  const url = `https://api.rainbow.ai/weather/v1/one-call?lat=${lat}&lon=${lon}&unit=metric`;
  const res = await fetch(url, {
    headers: { 'x-api-key': key },
  });
  if (!res.ok) throw new Error(`Rainbow: ${res.status}`);
  const data = await res.json();
  const now = Date.now();
  const current = data.current || {};
  const hourly = (data.hourly || [])
    .filter(h => h.dt * 1000 >= now - 3600000)
    .map(h => ({
      time: new Date(h.dt * 1000).toISOString().replace('.000Z', ''),
      ms: h.dt * 1000,
      probability: Math.round((h.pop || 0) * 100),
      precip_mm: h.rain?.['1h'] || 0,
      temp_c: h.temp ?? null,
      humidity: h.humidity ?? null,
      wind_kph: h.wind_speed ? h.wind_speed * 3.6 : null,
      weather_id: h.weather?.[0]?.id ?? null,
    }));
  return {
    current: {
      temp_c: current.temp ?? null,
      humidity: current.humidity ?? null,
      precipitation_mm: current.rain?.['1h'] || 0,
      wind_speed: current.wind_speed ? current.wind_speed * 3.6 : null,
      weather_id: current.weather?.[0]?.id ?? null,
      is_raining: (current.rain?.['1h'] || 0) > 0.1,
    },
    hourly,
  };
}

// Short-lived in-process cache of completed rain forecasts, keyed by "lat,lon".// Avoids repeating expensive external API calls (Open-Meteo/MET/OWM/Netatmo) when
// multiple locations/checks for the same coords run back-to-back (e.g. self-ping,
// sequential user /check). The DB already stores per-location alert *state*; this
// only dedupes the transient forecast fetch to cut CPU-seconds (billing) and latency.
const rainForecastCache = new Map();
const RAIN_FORECAST_CACHE_MS = 10 * 60 * 1000; // 10 minutes

async function getRainForecast(lat, lon, chatId) {
  const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = rainForecastCache.get(cacheKey);
  if (cached && Date.now() - cached.generatedAt < RAIN_FORECAST_CACHE_MS) {
    console.log(`[RainCascade] cache hit ${cacheKey}`);
    return cached.result;
  }

  let result = {
    current: null,
    minutely: [],
    forecast: [],
    daily: null,
    radar: { is_raining: false, intensity: 0 },
    source: 'none',
    isRaining: false,
    sourcesChecked: [],
    rainSignals: [],       // which independent sources report rain (dedup by provider name)
    hasOwmKey: false,      // user provided an OpenWeatherMap key => OWM is authoritative
  };

  // === PHASE 1: OWM is the ONLY source ===
  // Open-Meteo / MET / WeatherAPI / Rainbow / RainViewer are intentionally
  // NOT used: the user-provided OWM key is the single authoritative weather
  // source (current observation + 3-hourly forecast).
  const owmKey = chatId ? await getUserApiKey(chatId, 'owm') : null;
  const key = owmKey || OWM_KEY;

  if (key) {
    result.hasOwmKey = !!owmKey;
    result.source = 'OWM';
    result.sourcesChecked.push('OWM');
    try {
      const currentData = await fetchOWMCurrent(lat, lon, key);
      if (currentData) {
        result.current = {
          temp_c: currentData.temp_c,
          humidity: currentData.humidity,
          precipitation_mm: currentData.precip_mm,
          rain_mm: currentData.rain_mm,
          weather_code: currentData.weather_code,
          wind_speed: currentData.wind_kph,
          wind_deg: currentData.wind_deg,
          is_raining: currentData.is_raining,
          weather_icon: currentData.weather_icon,
          weather_desc: currentData.weather_desc,
        };
        result.nowLocalMs = currentData.ms;
        if (currentData.tzOffsetMs != null) result.tzOffsetMs = currentData.tzOffsetMs;
        if (currentData.is_raining) {
          result.rainSignals.push('OWM-current');
          result.rainSignals.push('OWM-authoritative');
          console.log(`[RainCascade] OWM current: rain now ${currentData.precip_mm.toFixed(2)}mm/h (${currentData.desc})`);
        }
      }

      const forecastData = await fetchOWM(lat, lon, key);
      if (forecastData?.list?.length) {
        if (forecastData.tzOffsetMs != null && result.tzOffsetMs == null) result.tzOffsetMs = forecastData.tzOffsetMs;
        result.forecast = forecastData.list;
        // OWM forecast is 3-hourly; treat rain within +180/-30 min as decisive,
        // because a 3h grid can place the first wet slot just past +120min.
        const nowMs = result.nowLocalMs || Date.now();
        const hasRain = result.forecast.some(f => {
          const diff = (f.ms - nowMs) / (1000 * 60);
          const probRain = (f.probability || 0) >= 40;
          return diff <= 180 && diff >= -30 && (f.precip_mm > 0.2 || probRain);
        });
        if (hasRain) {
          result.rainSignals.push('OWM');
          result.rainSignals.push('OWM-authoritative');
          console.log(`[RainCascade] OWM: rain in +180/-30min window`);
        } else {
          console.log(`[RainCascade] OWM: no rain in forecast window`);
        }
      }
    } catch (e) {
      console.warn('OWM failed:', e.message);
    }
  } else {
    console.warn('[RainCascade] No OWM key configured — card will show error');
  }

  result.lat = lat;
  result.lon = lon;

  // Ensure nowLocalMs / tzOffsetMs are always set
  if (!result.nowLocalMs) {
    result.nowLocalMs = Date.now();
    if (!result.tzOffsetMs) result.tzOffsetMs = (await getTzOffsetSec(lat, lon)) * 1000;
  }

  // === PHASE 2: OWM alone decides ===
  // OWM current observation or OWM forecast rain => it is/will be raining.
  // No multi-provider consensus needed: OWM is the only source by design.
  const strongCurrent =
    result.rainSignals.includes('OWM-current') ||
    result.rainSignals.includes('OWM-authoritative');
  const independentVotes = new Set(result.rainSignals).size;

  if (strongCurrent) {
    result.isRaining = true;
  } else if (independentVotes >= 2) {
    result.isRaining = true;
  }

  console.log(`[RainCascade] FINAL: isRaining=${result.isRaining}, signals=[${result.rainSignals.join(', ')}], independentVotes=${independentVotes}, sources=[${result.sourcesChecked.join(', ')}]`);

  rainForecastCache.set(cacheKey, { generatedAt: Date.now(), result });
  if (rainForecastCache.size > 64) {
    const oldest = rainForecastCache.keys().next().value;
    rainForecastCache.delete(oldest);
  }
  return result;
}

// === Weather Display ===
function getWeatherEmoji(probability, precipMm, wmoCode) {
  if (precipMm > 2) return '🌧';
  if (precipMm > 0.5) return '🌧';
  if (precipMm > 0.1) return '🌦';
  if (probability > 60) return '🌧';
  if (probability > 30) return '⛅';
  if (wmoCode != null && WMO_CODES[wmoCode]) return WMO_CODES[wmoCode].icon;
  return '☀️';
}

function makeRainBar(probability) {
  const filled = Math.round(probability / 10);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function makePrecipBar(precipMm) {
  if (precipMm <= 0) return '░░░░░░░░░░';
  if (precipMm < 0.5) return '█░░░░░░░░░';
  if (precipMm < 1) return '██░░░░░░░░';
  if (precipMm < 2) return '████░░░░░░';
  if (precipMm < 5) return '██████░░░░';
  return '████████░░';
}

function formatTime(timeStr) {
  if (!timeStr) return '??:??';
  const parts = timeStr.split('T');
  if (parts.length === 2) return parts[1];
  return '??:??';
}

// Build a LOCAL wall-clock "HH:MM" from an absolute epoch ms and tz offset.
// Works consistently for every provider (Open-Meteo and MET Norway alike),
// so forecast rows always show local time instead of UTC.
function localTimeStr(ms, tzOffsetMs) {
  if (!ms) return '??:??';
  const d = new Date(ms + (tzOffsetMs || 0));
  return `${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')}`;
}

// Human duration "Nд Nгод" / "Nгод Nхв" / "Nхв" (without leading preposition)
function formatRainETA(msUntil, lang) {
  const totalMin = Math.max(0, Math.round(msUntil / 60000));
  if (totalMin < 60) return t(lang, 'dur_minutes', { minutes: totalMin });
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const minutes = totalMin % 60;
  if (days > 0) {
    if (hours > 0) return t(lang, 'dur_days_hours', { days, hours });
    return t(lang, 'dur_days', { days });
  }
  if (minutes > 0) return t(lang, 'dur_hours_minutes', { hours, minutes });
  return t(lang, 'dur_hours', { hours });
}

function formatDate(timeStr, lang, tzOffsetMs, ms) {
  // Local date (YYYY-MM-DD) from an absolute epoch + tz offset, falling back
  // to the provider's date string when ms is unavailable.
  let datePart = null;
  if (ms) {
    const local = new Date(ms + (tzOffsetMs || 0));
    datePart = local.toISOString().split('T')[0];
  } else if (timeStr) {
    datePart = timeStr.split('T')[0];
  }
  if (!datePart) return '';
  const nowLocal = new Date(Date.now() + (tzOffsetMs || 0));
  const todayStr = nowLocal.toISOString().split('T')[0];
  const tomorrowStr = new Date(nowLocal.getTime() + 86400000).toISOString().split('T')[0];

  if (datePart === todayStr) return t(lang, 'date_today');
  if (datePart === tomorrowStr) return t(lang, 'date_tomorrow');
  const [y, m, d] = datePart.split('-').map(Number);
  const localeMap = { uk: 'uk-UA', en: 'en-US', ru: 'ru-RU', pl: 'pl-PL', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', pt: 'pt-PT', nl: 'nl-NL', cs: 'cs-CZ', sk: 'sk-SK', ro: 'ro-RO', hu: 'hu-HU', bg: 'bg-BG', hr: 'hr-HR', tr: 'tr-TR', ar: 'ar-SA', he: 'he-IL', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR' };
  const locale = localeMap[lang] || 'en-US';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, { day: 'numeric', month: 'long' });
}

function formatWeatherMessage(weatherData, lang, settings, label) {
  const { current, minutely, forecast, radar, source, isRaining, nowLocalMs, tzOffsetMs } = weatherData;

  const err = `⚠️ ${t(lang, 'error_no_forecast')}`;
  if (!current && (!forecast || forecast.length === 0)) {
    return { rich: err, plain: err };
  }

  // Location label (name from user_locations, else coords) prepended so a user
  // with multiple locations always knows which one this message refers to.
  const labelHtml = label ? `<b>${label}</b>\n` : '';
  const labelPlain = label ? `${label}\n` : '';

  const nowLocalDate = new Date(Date.now() + (tzOffsetMs || 0));
  const nowTimeStr = `${nowLocalDate.getUTCHours().toString().padStart(2, '0')}:${nowLocalDate.getUTCMinutes().toString().padStart(2, '0')}`;

  // ===== SHARED: header =====
  let headerText = '';
  if (isRaining) {
    const rainMm = current?.precipitation_mm || 0;
    headerText = rainMm > 3 ? `⚠️ ${t(lang, 'alert_strong_rain')}` : rainMm > 1 ? `🌧 ${t(lang, 'alert_rain')}` : `🌦 ${t(lang, 'alert_light_rain')}`;
  } else {
    const nextRain = minutely?.find(m => m.precip_mm > 0.1 && m.ms > nowLocalMs);
    if (nextRain) {
      headerText = `🌧 ${t(lang, 'alert_rain_in_time', { time: formatRainETA(nextRain.ms - nowLocalMs, lang) })}`;
    } else {
      const rainInForecast = forecast?.find(f => f.precip_mm > 0.2 && f.ms > nowLocalMs);
      if (rainInForecast) {
        headerText = `🌧 ${t(lang, 'alert_rain_in_time', { time: formatRainETA(rainInForecast.ms - nowLocalMs, lang) })}`;
      } else {
        headerText = t(lang, 'no_rain_header');
      }
    }
  }

  // ===== SHARED: current conditions =====
  let curMain = null;
  let curExtra = [];
  let radarLine = null;
  if (current && settings?.show_current !== false) {
    const rainIcon = current.is_raining ? '🌧' : current.weather_icon;
    curMain = [`${rainIcon} <b>${Math.round(current.temp_c)}°C</b>`, `💧 ${Math.round(current.humidity)}%`];
    curExtra = [`💨 ${Math.round(current.wind_speed)}${t(lang, 'unit_kmh')}`];
    if (current.precipitation_mm > 0) {
      curExtra.push(`🌧 ${current.precipitation_mm}${t(lang, 'unit_mm')}`);
    }
    if (radar?.is_raining && isRaining && settings?.show_radar !== false) {
      const radarDesc = ['', t(lang, 'radar_weak'), t(lang, 'radar_moderate'), t(lang, 'radar_strong'), t(lang, 'radar_very_strong'), t(lang, 'radar_extreme')];
      radarLine = `📡 ${t(lang, 'radar_label')}: ${radarDesc[radar.intensity] || t(lang, 'yes')} (${radar.ageMinutes || '?'}${t(lang, 'unit_min_ago')})`;
    }
  }

  // ===== SHARED: minutely rows =====
  let minRows = [];
  if (minutely && minutely.length > 0 && settings?.show_minutely !== false) {
    for (const m of minutely.slice(0, 8)) {
      const time = localTimeStr(m.ms, tzOffsetMs);
      const emoji = m.precip_mm > 2 ? '🌧' : m.precip_mm > 0.1 ? '🌦' : '☀️';
      const bar = makePrecipBar(m.precip_mm);
      const precip = m.precip_mm > 0 ? ` ${m.precip_mm.toFixed(1)}${t(lang, 'unit_mm')}` : '';
      minRows.push(`${time} ${emoji} ${bar}${precip}`);
    }
  }

  // ===== SHARED: hourly groups =====
  const hourGroups = [];
  if (forecast && forecast.length > 0 && settings?.show_hourly !== false) {
    let lastDate = '';
    for (const h of forecast.slice(0, 8)) {
      const dateStr = formatDate(h.timeStr, lang, tzOffsetMs, h.ms);
      if (dateStr !== lastDate) {
        hourGroups.push({ dateStr, rows: [] });
        lastDate = dateStr;
      }
      const time = localTimeStr(h.ms, tzOffsetMs);
      const emoji = getWeatherEmoji(h.probability, h.precip_mm, h.wmo_code);
      const temp = h.temp_c !== null ? `${Math.round(h.temp_c)}°` : '--';
      const precip = h.precip_mm > 0 ? ` ${h.precip_mm.toFixed(1)}${t(lang, 'unit_mm')}` : '';
      hourGroups[hourGroups.length - 1].rows.push(`${time} ${emoji} ${h.probability != null ? String(h.probability).padStart(2) + '%' : '  ·'} ${String(temp).padStart(3)}${precip}`);
    }
  }

  // ===== SHARED: recommendation =====
  const posture = settings?.posture || 'inside';
  const isOutside = posture === 'outside';
  let recText = '';

  if (isRaining) {
    recText = isOutside ? t(lang, 'rec_rain_outside') : t(lang, 'rec_rain_inside');
  } else {
    const nextRainMinutely = minutely?.find(m => m.precip_mm > 0.1 && m.ms > nowLocalMs);
    const nextRainHourly = forecast?.find(f => f.precip_mm > 0.2 && f.ms > nowLocalMs);
    let rainETAms = null;
    if (nextRainMinutely) rainETAms = nextRainMinutely.ms;
    else if (nextRainHourly) rainETAms = nextRainHourly.ms;

    if (rainETAms) {
      const minsAway = Math.round((rainETAms - nowLocalMs) / 60000);
      const hoursAway = Math.round(minsAway / 60);
      let timeStr;
      if (minsAway < 60) {
        timeStr = t(lang, 'eta_minutes', { minutes: minsAway });
      } else if (hoursAway === 1) {
        timeStr = t(lang, 'eta_hour');
      } else {
        timeStr = t(lang, 'eta_hours', { hours: hoursAway });
      }

      if (minsAway <= 30) {
        recText = isOutside ? t(lang, 'rec_urgent_outside', { time: timeStr }) : t(lang, 'rec_urgent_inside', { time: timeStr });
      } else if (minsAway <= 120) {
        recText = isOutside ? t(lang, 'rec_moderate_outside', { time: timeStr }) : t(lang, 'rec_moderate_inside', { time: timeStr });
      } else {
        recText = isOutside ? t(lang, 'rec_far_outside', { time: timeStr }) : t(lang, 'rec_far_inside', { time: timeStr });
      }
    } else {
      recText = isOutside ? t(lang, 'rec_no_rain_outside') : t(lang, 'rec_no_rain_inside');
    }
  }
  const recEmoji = isRaining ? '⚠️' : (recText === (isOutside ? t(lang, 'rec_no_rain_outside') : t(lang, 'rec_no_rain_inside')) ? '✅' : '🟡');

  // ===== SHARED: severe weather warnings =====
  const hasSevereCurrent = current && WMO_CODES[current.weather_code]?.severe;
  const hasSevereForecast = forecast?.some(f => WMO_CODES[f.wmo_code]?.severe && f.ms > nowLocalMs && f.ms < nowLocalMs + (settings?.lookahead_min || 60) * 60 * 1000);
  const hasHailNow = current && (current.weather_code === 96 || current.weather_code === 99);
  const hasHailSoon = forecast?.some(f => (f.wmo_code === 96 || f.wmo_code === 99) && f.ms > nowLocalMs && f.ms < nowLocalMs + 120 * 60 * 1000);

  let severeWarn = false;
  let severeLines = [];
  if (hasSevereCurrent || hasSevereForecast || hasHailNow || hasHailSoon) {
    severeWarn = true;
    if (hasHailNow) {
      severeLines.push(`⛈ <b>${t(lang, 'severe_hail_now')}</b>`);
      severeLines.push(t(lang, 'severe_hail_shelter'));
    } else if (hasSevereCurrent) {
      const sevDesc = t(lang, 'wmo_' + current.weather_code) || WMO_CODES[current.weather_code]?.desc || '';
      severeLines.push(`⛈ <b>${sevDesc} ${t(lang, 'severe_now')}</b>`);
      severeLines.push(t(lang, 'severe_wait_shelter'));
    }
    if (hasHailSoon && !hasHailNow) {
      const hailTime = forecast.find(f => (f.wmo_code === 96 || f.wmo_code === 99) && f.ms > nowLocalMs);
      if (hailTime) {
        const hailMins = Math.round((hailTime.ms - nowLocalMs) / 60000);
        const hailHrs = Math.round(hailMins / 60);
        const hailETA = hailMins < 60 ? t(lang, 'eta_minutes', { minutes: hailMins }) : t(lang, 'eta_hours', { hours: hailHrs });
        severeLines.push(`⛈ <b>${t(lang, 'severe_hail_soon', { time: hailETA })}</b>`);
        severeLines.push(t(lang, 'severe_hail_prepare'));
      }
    } else if (hasSevereForecast && !hasSevereCurrent) {
      const sevTime = forecast.find(f => WMO_CODES[f.wmo_code]?.severe && f.ms > nowLocalMs);
      if (sevTime) {
        const sevMins = Math.round((sevTime.ms - nowLocalMs) / 60000);
        const sevHrs = Math.round(sevMins / 60);
        const sevETA = sevMins < 60 ? t(lang, 'eta_minutes', { minutes: sevMins }) : t(lang, 'eta_hours', { hours: sevHrs });
        severeLines.push(`⛈ <b>${t(lang, 'severe_storm_soon', { time: sevETA })}</b>`);
        severeLines.push(t(lang, 'severe_prepare_shelter'));
      }
    }
  }

  // ===== SHARED: footer =====
  const footerParts = [t(lang, 'updated_at', { time: nowTimeStr })];
  if (weatherData.sourcesChecked?.length) {
    footerParts.push(weatherData.sourcesChecked.join(' + '));
  } else if (source) {
    footerParts.push(source);
  }

  // ===== SHARED: daily sun times =====
  let dailyLine = null;
  if (weatherData.daily && settings?.show_daily !== false) {
    const hm = s => s ? s.split('T')[1].slice(0, 5) : '--:--';
    const d = weatherData.daily;
    dailyLine = `🌅 ${hm(d.sunrise)} · 🌇 ${hm(d.sunset)} · ⬆️${d.tmax != null ? Math.round(d.tmax) : '--'}° ⬇️${d.tmin != null ? Math.round(d.tmin) : '--'}°`;
  }

  // ===== RICH VERSION (Bot API 10.1+ Rich Messages) =====
  // Best practices: one clear heading, short summary, h3 sections,
  // table with caption for structured data, blockquote/aside for key statuses,
  // details for optional depth, map + footer as closing blocks.
  let rich = `${labelHtml}<h2>${headerText}</h2>`;
  if (dailyLine) rich += `<p>${dailyLine}</p>`;
  if (curMain) {
    rich += `<table bordered striped><caption>📍 ${t(lang, 'current_label')}</caption>`;
    rich += `<tr><td>${curMain[0]}</td><td>${curMain[1]}</td></tr>`;
    rich += `<tr><td>${curExtra[0] || ''}</td><td>${curExtra[1] || ''}</td></tr>`;
    if (radarLine) rich += `<tr><td colspan="2">${radarLine}</td></tr>`;
    rich += `</table>`;
  }
  if (minRows.length) {
    rich += `<details><summary>⏱ ${t(lang, 'minutely_label')}</summary>` +
      `<pre>${minRows.join('\n')}</pre></details>`;
  }
  if (hourGroups.length) {
    let hr = '';
    for (const g of hourGroups) {
      hr += `<b>${g.dateStr}</b>\n` + g.rows.join('\n');
    }
    rich += `<details open><summary>🗓 ${t(lang, 'forecast_label')}</summary><pre>${hr.trimEnd()}</pre></details>`;
  }
  rich += `<blockquote>${recEmoji} ${recText}</blockquote>`;
  if (severeWarn) {
    rich += `<aside>🚨 <b>${t(lang, 'severe_title')}</b></aside>` +
      severeLines.map(l => `<p>${l}</p>`).join('');
  }
  rich += `<hr/><footer>${footerParts.join(' | ')}</footer>`;

  // ===== PLAIN VERSION (fallback for Telegram Web/X/macOS) =====
  let plain = `${labelPlain}<b>${headerText}</b>`;
  if (dailyLine) plain += `\n${dailyLine}`;
  if (curMain) {
    plain += `\n\n📍 <b>${t(lang, 'current_label')}</b>\n${curMain[0]}  ${curMain[1]}\n${curExtra.join('   ')}`;
    if (radarLine) plain += `\n${radarLine}`;
  }
  if (minRows.length) {
    plain += `\n\n⏱ <b>${t(lang, 'minutely_label')}</b>\n<pre>${minRows.join('\n')}</pre>`;
  }
  if (hourGroups.length) {
    let hr = '';
    for (const g of hourGroups) {
      hr += `<b>${g.dateStr}</b>\n` + g.rows.join('\n');
    }
    plain += `\n\n🗓 <b>${t(lang, 'forecast_label')}</b>\n<pre>${hr.trimEnd()}</pre>`;
  }
  plain += `\n\n<blockquote>${recEmoji} ${recText}</blockquote>`;
  if (severeWarn) {
    plain += `\n\n🚨 <b>${t(lang, 'severe_title')}</b>\n${severeLines.join('\n')}`;
  }
  plain += `\n\n<i>${footerParts.join(' · ')}</i>`;

  return { rich, plain };
}

// === Callback Handler ===
const pendingCallbacks = {};

async function handleCallbackQuery(callbackQuery) {
  const chatId = callbackQuery.message?.chat?.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message?.message_id;

  if (!chatId || !data) return;

  const user = await getUser(chatId);
  const lang = user?.language || 'uk';

  await tgAnswerCallback(callbackQuery.id);

  if (data === 'cb_location') {
    await sendWithFallback(chatId, t(lang, 'send_location_prompt'), {
      reply_markup: { remove_keyboard: true },
    });
    return;
  }

  if (data === 'cb_check') {
    const u = await getUser(chatId);
    if (!u || !u.latitude) {
      await sendWithFallback(chatId, t(lang, 'location_needed'), { reply_markup: mainMenuKeyboard(lang) });
      return;
    }
    const weatherData = await getRainForecast(u.latitude, u.longitude, chatId);
    const settings = await getUserSettings(chatId);
    const label = await locationLabel(chatId, u.latitude, u.longitude);
    const msg = formatWeatherMessage(weatherData, lang, settings, label);
    const result = await sendWithFallback(chatId, msg.rich, { reply_markup: mainMenuKeyboard(lang) }, msg.plain);
    if (result.ok) {
      await saveUser(chatId, { last_message_id: result.result.message_id });
    }
    return;
  }

  if (data === 'cb_update') {
    const u = await getUser(chatId);
    if (!u || !u.latitude) {
      await sendWithFallback(chatId, t(lang, 'location_needed'), { reply_markup: mainMenuKeyboard(lang) });
      return;
    }
    const weatherData = await getRainForecast(u.latitude, u.longitude, chatId);
    const settings = await getUserSettings(chatId);
    const label = await locationLabel(chatId, u.latitude, u.longitude);
    const msg = formatWeatherMessage(weatherData, lang, settings, label);
    if (messageId) {
      const r = await editWithFallback(chatId, messageId, msg.rich, { reply_markup: mainMenuKeyboard(lang) }, msg.plain);
      if (!r.ok) {
        const s2 = await sendWithFallback(chatId, msg.rich, { reply_markup: mainMenuKeyboard(lang) }, msg.plain);
        if (s2.ok) await saveUser(chatId, { last_message_id: s2.result.message_id });
      } else {
        await saveUser(chatId, { last_message_id: messageId });
      }
    }
    await tgAnswerCallback(callbackQuery.id, t(lang, 'toast_updated'));
    return;
  }

  if (data === 'cb_settings' || data === 'cb_settings_detail') {
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    const keys = await getAllUserApiKeys(chatId);
    const postureEmoji = settings?.posture === 'outside' ? '🚶' : '🏠';
    const msg = `<b>${t(uLang, 'settings_title')}</b>\n\n` +
      `🌧 ${t(uLang, 'set_rain_threshold')}: <b>${settings?.rain_threshold_mm || 0.5}${t(uLang, 'unit_mm')}</b>\n` +
      `⏱ ${t(uLang, 'set_lookahead')}: <b>${settings?.lookahead_min || 30}${t(uLang, 'unit_min')}</b>\n` +
      `🧪 ${t(uLang, 'exp_trajectory')}: <b>${settings?.exp_trajectory === true ? t(uLang, 'on') : t(uLang, 'off')}</b>\n` +
      `⏰ ${t(uLang, 'set_cooldown')}: <b>${settings?.alert_cooldown_min || 30}${t(uLang, 'unit_min')}</b>\n` +
      `${postureEmoji} ${t(uLang, 'set_mode')}: <b>${settings?.posture === 'outside' ? t(uLang, 'mode_outside') : t(uLang, 'mode_inside')}</b>\n\n` +
      `🌐 ${t(uLang, 'language_label')}: ${getLangFlag(uLang)} ${getLangName(uLang)}\n` +
      `🔑 ${t(uLang, 'api_keys_label')}: ${keys.length}`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: settingsDetailKeyboard(uLang, settings) });
    return;
  }

  if (data === 'cb_settings_threshold') {
    await tgAnswerCallback(callbackQuery.id, t(lang, 'toast_select_threshold'));
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    const msg = `<b>🌧 ${t(uLang, 'set_rain_threshold')}</b>\n\n${t(uLang, 'set_threshold_desc')}.\n${t(uLang, 'current_label')}: <b>${settings?.rain_threshold_mm || 0.5}${t(uLang, 'unit_mm')}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: thresholdKeyboard(uLang) });
    return;
  }

  if (data.startsWith('cb_set_threshold_')) {
    const value = parseFloat(data.replace('cb_set_threshold_', ''));
    await saveUserSettings(chatId, { rain_threshold_mm: value });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, `${t(lang, 'toast_threshold_set')}: ${value}`);
    const msg = `<b>${t(lang, 'settings_threshold_set', { value })}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: thresholdKeyboard(uLang) });
    return;
  }

  if (data === 'cb_settings_lookahead') {
    await tgAnswerCallback(callbackQuery.id, t(lang, 'toast_select_lookahead'));
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    const msg = `<b>⏱ ${t(uLang, 'set_lookahead')}</b>\n\n${t(uLang, 'set_lookahead_desc')}.\n${t(uLang, 'current_label')}: <b>${settings?.lookahead_min || 30}${t(uLang, 'unit_min')}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: lookaheadKeyboard(uLang) });
    return;
  }

  if (data.startsWith('cb_set_lookahead_')) {
    const value = parseInt(data.replace('cb_set_lookahead_', ''));
    await saveUserSettings(chatId, { lookahead_min: value });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    await tgAnswerCallback(callbackQuery.id, `${t(lang, 'settings_lookahead_set')}: ${value}`);
    const msg = `<b>${t(lang, 'settings_lookahead_set', { value })}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: lookaheadKeyboard(uLang) });
    return;
  }

  if (data === 'cb_settings_exp') {
    const settings = await getUserSettings(chatId);
    const newEnabled = settings?.exp_trajectory === false;
    await saveUserSettings(chatId, { exp_trajectory: newEnabled });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const updatedSettings = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, newEnabled ? t(lang, 'toast_exp_on') : t(lang, 'toast_exp_off'));
    const msg = `<b>🧪 ${t(uLang, 'exp_trajectory')}</b>\n\n${t(uLang, 'exp_trajectory_desc')}.\n\n${t(uLang, 'current_label')}: <b>${newEnabled ? t(uLang, 'on') : t(uLang, 'off')}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: settingsDetailKeyboard(uLang, updatedSettings) });
    return;
  }

  if (data === 'cb_settings_exp_radius') {
    const settings = await getUserSettings(chatId);
    const cur = Number(settings?.exp_radius_km) || 10;
    const options = [10, 20, 30];
    const next = options[(options.indexOf(cur) + 1) % options.length] || 10;
    try {
      await saveUserSettings(chatId, { exp_radius_km: next });
    } catch (e) {
      console.warn(`[SETTINGS] could not persist exp_radius_km for ${chatId}:`, e.message);
      await tgAnswerCallback(callbackQuery.id, t(lang, 'error_generic'));
      return;
    }
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const updatedSettings = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, `${t(lang, 'exp_radius')}: ${next} ${t(lang, 'unit_km')}`);
    const msg = `<b>🎯 ${t(uLang, 'exp_radius')}</b>\n\n${t(uLang, 'exp_radius_desc')}.\n${t(uLang, 'current_label')}: <b>${next} ${t(uLang, 'unit_km')}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: settingsDetailKeyboard(uLang, updatedSettings) });
    return;
  }

  if (data === 'cb_settings_cooldown') {
    await tgAnswerCallback(callbackQuery.id, t(lang, 'toast_select_cooldown'));
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    const msg = `<b>⏰ ${t(uLang, 'set_cooldown')}</b>\n\n${t(uLang, 'set_cooldown_desc')}.\n${t(uLang, 'current_label')}: <b>${settings?.alert_cooldown_min || 30}${t(uLang, 'unit_min')}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: cooldownKeyboard(uLang) });
    return;
  }

  if (data.startsWith('cb_set_cooldown_')) {
    const value = parseInt(data.replace('cb_set_cooldown_', ''));
    await saveUserSettings(chatId, { alert_cooldown_min: value });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    await tgAnswerCallback(callbackQuery.id, `${t(lang, 'toast_select_cooldown')}: ${value}`);
    const msg = `<b>✅ ${t(uLang, 'set_cooldown')}: ${value}${t(uLang, 'unit_min')}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: cooldownKeyboard(uLang) });
    return;
  }

  if (data === 'cb_settings_posture') {
    const settings = await getUserSettings(chatId);
    const newPosture = settings?.posture === 'outside' ? 'inside' : 'outside';
    await saveUserSettings(chatId, { posture: newPosture });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const updatedSettings = await getUserSettings(chatId);
    const label = newPosture === 'outside' ? `${t(uLang, 'mode_outside')}` : `${t(uLang, 'mode_inside')}`;
    await tgAnswerCallback(callbackQuery.id, `${t(uLang, 'toast_mode_changed')}: ${label}`);
    const msg = `<b>✅ ${t(uLang, 'toast_mode_changed')}: ${label}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: settingsDetailKeyboard(uLang, updatedSettings) });
    return;
  }

  // === Advanced Settings ===

  if (data === 'cb_adv_settings') {
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    const msg = `<b>🔧 ${t(uLang, 'set_advanced')}</b>\n\n${t(uLang, 'set_posture_desc')}.`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: advancedSettingsKeyboard(uLang, settings) });
    return;
  }

  if (data === 'cb_adv_quiet') {
    const settings = await getUserSettings(chatId);
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const qhOn = settings?.quiet_hours_start && settings?.quiet_hours_end;
    const msg = `<b>🔕 ${t(uLang, 'set_quiet_hours')}</b>\n\n${t(uLang, 'set_quiet_hours_desc')}.\n${t(uLang, 'current_label')}: ${qhOn ? settings.quiet_hours_start + '-' + settings.quiet_hours_end : t(uLang, 'off')}`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: quietHoursKeyboard(uLang) });
    return;
  }

  if (data === 'cb_adv_earlywarn') {
    const settings = await getUserSettings(chatId);
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const msg = `<b>🔔 ${t(uLang, 'set_early_warn')}</b>\n\n${t(uLang, 'set_early_warn_desc')}.`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: earlyWarnKeyboard(uLang, settings) });
    return;
  }

  if (data.startsWith('cb_set_earlywarn_')) {
    const val = parseInt(data.replace('cb_set_earlywarn_', ''));
    const u = await getUser(chatId).catch(() => null);
    const uLang = u?.language || 'uk';
    try {
      await saveUserSettings(chatId, { early_warn_hours: val === 0 ? null : val });
      const settings = await getUserSettings(chatId);
      await tgAnswerCallback(callbackQuery.id, val === 0 ? t(uLang, 'off') : t(uLang, 'early_warn_hours', { hours: val }));
      const msg = val === 0 ? `<b>✅ ${t(uLang, 'set_early_warn')}: ${t(uLang, 'off')}</b>` : `<b>✅ ${t(uLang, 'set_early_warn')}: ${t(uLang, 'early_warn_hours', { hours: val })}</b>`;
      await editWithFallback(chatId, messageId, msg, { reply_markup: advancedSettingsKeyboard(uLang, settings) });
    } catch (err) {
      console.error(`Early warn save error for ${chatId}:`, err.message);
      await tgAnswerCallback(callbackQuery.id, '❌').catch(() => {});
    }
    return;
  }

  if (data.startsWith('cb_qh_start_')) {
    const startHour = parseInt(data.replace('cb_qh_start_', ''));
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const msg = `<b>🔕 ${t(uLang, 'set_quiet_hours')}</b>\n\n${t(uLang, 'current_label')}: <b>${startHour.toString().padStart(2,'0')}:00</b>\n${t(uLang, 'set_quiet_hours_desc')}:`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: quietHoursEndKeyboard(uLang, startHour) });
    return;
  }

  if (data.startsWith('cb_qh_end_')) {
    const parts = data.replace('cb_qh_end_', '').split('_');
    const startHour = parseInt(parts[0]);
    const endHour = parseInt(parts[1]);
    const startStr = startHour.toString().padStart(2,'0') + ':00';
    const endStr = endHour.toString().padStart(2,'0') + ':00';
    await saveUserSettings(chatId, { quiet_hours_start: startStr, quiet_hours_end: endStr });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, `${startStr}-${endStr}`);
    const msg = `<b>✅ ${t(uLang, 'set_quiet_hours')}: ${startStr} - ${endStr}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: advancedSettingsKeyboard(uLang, settings) });
    return;
  }

  if (data === 'cb_qh_off') {
    await saveUserSettings(chatId, { quiet_hours_start: null, quiet_hours_end: null });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, t(uLang, 'off'));
    const msg = `<b>✅ ${t(uLang, 'set_quiet_hours')}: ${t(uLang, 'off')}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: advancedSettingsKeyboard(uLang, settings) });
    return;
  }

  if (data === 'cb_adv_wind') {
    const settings = await getUserSettings(chatId);
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const msg = `<b>💨 ${t(uLang, 'set_wind_threshold')}</b>\n\n${t(uLang, 'set_wind_threshold_desc')}.\n${t(uLang, 'current_label')}: ${settings?.wind_threshold_kmh ? '>'+settings.wind_threshold_kmh+t(uLang, 'unit_kmh') : t(uLang, 'off')}`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: windThresholdKeyboard(uLang) });
    return;
  }

  if (data.startsWith('cb_set_wind_')) {
    const val = parseInt(data.replace('cb_set_wind_', ''));
    await saveUserSettings(chatId, { wind_threshold_kmh: val === 0 ? null : val });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, val === 0 ? t(uLang, 'off') : `>${val}${t(uLang, 'unit_kmh')}`);
    const msg = val === 0 ? `<b>✅ ${t(uLang, 'set_wind_threshold')}: ${t(uLang, 'off')}</b>` : `<b>✅ ${t(uLang, 'set_wind_threshold')}: >${val}${t(uLang, 'unit_kmh')}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: advancedSettingsKeyboard(uLang, settings) });
    return;
  }

  if (data === 'cb_adv_humidity') {
    const settings = await getUserSettings(chatId);
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const msg = `<b>💧 ${t(uLang, 'set_humidity_threshold')}</b>\n\n${t(uLang, 'set_humidity_threshold_desc')}.\n${t(uLang, 'current_label')}: ${settings?.humidity_threshold_pct ? '>'+settings.humidity_threshold_pct+'%' : t(uLang, 'off')}`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: humidityThresholdKeyboard(uLang) });
    return;
  }

  if (data.startsWith('cb_set_hum_')) {
    const val = parseInt(data.replace('cb_set_hum_', ''));
    await saveUserSettings(chatId, { humidity_threshold_pct: val === 0 ? null : val });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, val === 0 ? t(uLang, 'off') : `>${val}%`);
    const msg = val === 0 ? `<b>✅ ${t(uLang, 'set_humidity_threshold')}: ${t(uLang, 'off')}</b>` : `<b>✅ ${t(uLang, 'set_humidity_threshold')}: >${val}%</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: advancedSettingsKeyboard(uLang, settings) });
    return;
  }

  if (data === 'cb_adv_temp') {
    const settings = await getUserSettings(chatId);
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const msg = `<b>🌡 ${t(uLang, 'set_temp_threshold')}</b>\n\n${t(uLang, 'set_temp_threshold_desc')}.\n${t(uLang, 'current_label')}: ${settings?.temp_threshold_c != null ? '<'+settings.temp_threshold_c+'°C' : t(uLang, 'off')}`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: tempThresholdKeyboard(uLang) });
    return;
  }

  if (data.startsWith('cb_set_temp_')) {
    const val = parseInt(data.replace('cb_set_temp_', ''));
    await saveUserSettings(chatId, { temp_threshold_c: val === 999 ? null : val });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, val === 999 ? t(uLang, 'off') : `<${val}°C`);
    const msg = val === 999 ? `<b>✅ ${t(uLang, 'set_temp_threshold')}: ${t(uLang, 'off')}</b>` : `<b>✅ ${t(uLang, 'set_temp_threshold')}: <${val}°C</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: advancedSettingsKeyboard(uLang, settings) });
    return;
  }

  if (data === 'cb_adv_rain_levels') {
    const settings = await getUserSettings(chatId);
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const msg = `<b>🌩 ${t(uLang, 'set_rain_levels')}</b>\n\n${t(uLang, 'set_rain_levels_desc')}:`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: rainLevelsKeyboard(uLang, settings) });
    return;
  }

  const toggleRainLevel = async (field) => {
    const settings = await getUserSettings(chatId);
    const current = settings?.[field] !== false;
    await saveUserSettings(chatId, { [field]: !current });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const updated = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, current ? t(uLang, 'off') : t(uLang, 'on'));
    const msg = `<b>🌩 ${t(uLang, 'set_rain_levels')}</b>\n\n${t(uLang, 'set_rain_levels_desc')}:`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: rainLevelsKeyboard(uLang, updated) });
  };

  if (data === 'cb_toggle_drizzle') { await toggleRainLevel('alert_drizzle'); return; }
  if (data === 'cb_toggle_light_rain') { await toggleRainLevel('alert_light_rain'); return; }
  if (data === 'cb_toggle_heavy_rain') { await toggleRainLevel('alert_heavy_rain'); return; }
  if (data === 'cb_toggle_thunderstorm') { await toggleRainLevel('alert_thunderstorm'); return; }

  if (data === 'cb_adv_sections') {
    const settings = await getUserSettings(chatId);
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const msg = `<b>📊 ${t(uLang, 'set_sections')}</b>\n\n${t(uLang, 'set_sections_desc')}:`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: sectionsKeyboard(uLang, settings) });
    return;
  }

  const toggleSection = async (field) => {
    const settings = await getUserSettings(chatId);
    const current = settings?.[field] !== false;
    await saveUserSettings(chatId, { [field]: !current });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const updated = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, current ? t(uLang, 'btn_disable') : t(uLang, 'on'));
    const msg = `<b>📊 ${t(uLang, 'set_sections')}</b>\n\n${t(uLang, 'set_sections_desc')}:`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: sectionsKeyboard(uLang, updated) });
  };

  if (data === 'cb_toggle_current') { await toggleSection('show_current'); return; }
  if (data === 'cb_toggle_hourly') { await toggleSection('show_hourly'); return; }

  // === Multi-Location ===

  if (data === 'cb_adv_locations') {
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const locations = await getUserLocations(chatId);
    const msg = `<b>📍 ${t(uLang, 'set_locations')}</b>\n\n${t(uLang, 'set_locations_desc')}.\n⭐ = ${t(uLang, 'current_label')}`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: locationsKeyboard(uLang, locations) });
    return;
  }

  if (data.startsWith('cb_loc_default_')) {
    const locId = parseInt(data.replace('cb_loc_default_', ''));
    await setDefaultLocation(chatId, locId);
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const locations = await getUserLocations(chatId);
    const loc = locations.find(l => l.id === locId);
    await saveUser(chatId, { latitude: loc.latitude, longitude: loc.longitude });
    await tgAnswerCallback(callbackQuery.id, `${t(uLang, 'location_set_default')}: ${loc?.name}`);
    const msg = `<b>✅ ${t(uLang, 'location_set_default')}: ${loc?.name}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: locationsKeyboard(uLang, locations) });
    return;
  }

  if (data.startsWith('cb_loc_delete_')) {
    const locId = parseInt(data.replace('cb_loc_delete_', ''));
    const locations = await getUserLocations(chatId);
    if (locations.length <= 1) {
      const u = await getUser(chatId);
      const uLang = u?.language || 'uk';
      await tgAnswerCallback(callbackQuery.id, t(uLang, 'location_cannot_delete_last'), true);
      return;
    }
    const loc = locations.find(l => l.id === locId);
    await deleteUserLocation(chatId, locId);
    if (loc?.is_default) {
      const remaining = locations.filter(l => l.id !== locId);
      if (remaining.length > 0) {
        await setDefaultLocation(chatId, remaining[0].id);
        await saveUser(chatId, { latitude: remaining[0].latitude, longitude: remaining[0].longitude });
      }
    }
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const updatedLocations = await getUserLocations(chatId);
    await tgAnswerCallback(callbackQuery.id, `${t(uLang, 'location_deleted')}: ${loc?.name}`);
    const msg = `<b>🗑 ${t(uLang, 'location_deleted')}: "${loc?.name}"</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: locationsKeyboard(uLang, updatedLocations) });
    return;
  }

  if (data === 'cb_loc_add') {
    pendingCallbacks[chatId] = { action: 'location_name', messageId };
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    await sendWithFallback(chatId, `📍 ${t(uLang, 'location_name_prompt')}:`, {
      reply_markup: {
        keyboard: [[{ text: `📍 ${t(uLang, 'send_geolocation')}`, request_location: true }]],
        one_time_keyboard: true,
        resize_keyboard: true,
      },
    });
    await sendWithFallback(chatId, `${t(uLang, 'location_add_prompt')}:`, {
      reply_markup: { inline_keyboard: [[{ text: t(uLang, 'btn_back'), callback_data: 'cb_adv_locations' }]] },
    });
    return;
  }

  if (data === 'cb_api_keys') {
    const keys = await getAllUserApiKeys(chatId);
    const activeProviders = keys.map(k => k.provider);
    const msg = `<b>${t(lang, 'api_keys_title')}</b>\n\n${t(lang, 'api_keys_desc')}\n\n${t(lang, 'api_register_hint')}`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: apiKeysKeyboard(lang, activeProviders) });
    return;
  }

  if (data.startsWith('cb_toggle_key_')) {
    const provider = data.replace('cb_toggle_key_', '');
    const providerNames = { weatherapi: 'WeatherAPI.com', owm: 'OpenWeatherMap', rainbow: 'Rainbow Weather' };
    const providerName = providerNames[provider] || provider;

    const existingKey = await getUserApiKey(chatId, provider);
    if (existingKey) {
      await deleteUserApiKey(chatId, provider);
      const keys = await getAllUserApiKeys(chatId);
      const activeProviders = keys.map(k => k.provider);
      await sendWithFallback(chatId, `${t(lang, 'api_key_deleted')} ${providerName}`, { reply_markup: apiKeysKeyboard(lang, activeProviders) });
    } else {
      pendingCallbacks[chatId] = { action: 'api_key', provider, messageId };
      await sendWithFallback(chatId, t(lang, 'api_enter_key', { provider: providerName }), {
        reply_markup: confirmKeyKeyboard(lang, provider),
      });
    }
    return;
  }

  if (data === 'cb_lang') {
    const msg = `<b>${t(lang, 'language_title')}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: languageKeyboard(0, lang) });
    return;
  }

  if (data.startsWith('cb_lang_page_')) {
    const page = parseInt(data.replace('cb_lang_page_', ''));
    const msg = `<b>${t(lang, 'language_title')}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: languageKeyboard(page, lang) });
    return;
  }

  if (data.startsWith('cb_lang_') && !data.startsWith('cb_lang_page_')) {
    const newLang = data.replace('cb_lang_', '');
    await saveUser(chatId, { language: newLang });
    const msg = `<b>${t(newLang, 'settings_title')}</b>\n\n${t(newLang, 'settings_language_changed', { language: `${getLangFlag(newLang)} ${getLangName(newLang)}` })}`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: settingsKeyboard(newLang) });
    return;
  }

  if (data === 'cb_back_main') {
    const msg = `<b>${t(lang, 'welcome')}</b>\n\n${t(lang, 'subtitle')}`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: mainMenuKeyboard(lang) });
    return;
  }
}

// === Message Handler ===
async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = message.text;

  if (text === '/start' || text === '/help') {
    let user = await getUser(chatId);
    if (!user) {
      const tgLang = (message.from?.language_code || '').split('-')[0];
      const lang = SUPPORTED_LANGS.includes(tgLang) ? tgLang : 'uk';
      await saveUser(chatId, { enabled: true, language: lang });
      user = await getUser(chatId);
    }
    const lang = user?.language || 'uk';
    await sendWithFallback(chatId,
      `<b>${t(lang, 'welcome')}</b>\n\n${t(lang, 'subtitle')}`,
      { reply_markup: mainMenuKeyboard(lang) }
    );
    return;
  }

  if (text === '/stop') {
    await saveUser(chatId, { enabled: false });
    const user = await getUser(chatId);
    const lang = user?.language || 'uk';
    await sendWithFallback(chatId, t(lang, 'btn_stop') || t(lang, 'notifications_disabled'), { reply_markup: mainMenuKeyboard(lang) });
    return;
  }

  if (text === '/inside') {
    await saveUserSettings(chatId, { posture: 'inside' });
    const user = await getUser(chatId);
    const lang = user?.language || 'uk';
    await sendWithFallback(chatId, t(lang, 'mode_inside_msg'), { reply_markup: mainMenuKeyboard(lang) });
    return;
  }

  if (text === '/outside') {
    await saveUserSettings(chatId, { posture: 'outside' });
    const user = await getUser(chatId);
    const lang = user?.language || 'uk';
    await sendWithFallback(chatId, t(lang, 'mode_outside_msg'), { reply_markup: mainMenuKeyboard(lang) });
    return;
  }

  if (text === '/check') {
    const user = await getUser(chatId);
    const lang = user?.language || 'uk';
    if (!user || !user.latitude) {
      await sendWithFallback(chatId, t(lang, 'location_needed'), { reply_markup: mainMenuKeyboard(lang) });
      return;
    }
    const weatherData = await getRainForecast(user.latitude, user.longitude, chatId);
    const settings = await getUserSettings(chatId);
    const label = await locationLabel(chatId, user.latitude, user.longitude);
    const msg = formatWeatherMessage(weatherData, lang, settings, label);
    const result = await sendWithFallback(chatId, msg.rich, { reply_markup: mainMenuKeyboard(lang) }, msg.plain);
    if (result.ok) {
      await saveUser(chatId, { last_message_id: result.result.message_id });
    }
    return;
  }

  if (message.location) {
    // If user is mid-way adding a named location, route the shared pin into the
    // add-location flow instead of overwriting the default location.
    const pendingAction = pendingCallbacks[chatId]?.action;
    if (pendingAction === 'location_name' || pendingAction === 'location_coords') {
      const lat = message.location.latitude;
      const lon = message.location.longitude;
      const name = pendingAction === 'location_coords'
        ? pendingCallbacks[chatId].name
        : t((await getUser(chatId))?.language || 'uk', 'set_locations');
      delete pendingCallbacks[chatId];
      await addUserLocation(chatId, name, lat, lon);
      const u2 = await getUser(chatId);
      const lang2 = u2?.language || 'uk';
      const locations = await getUserLocations(chatId);
      await sendWithFallback(chatId, `✅ ${t(lang2, 'location_saved_success')} "${name}"`, {
        reply_markup: { remove_keyboard: true },
      });
      await sendWithFallback(chatId, `${t(lang2, 'your_locations')}`, { reply_markup: locationsKeyboard(lang2, locations) });
      return;
    }

    await saveUser(chatId, {
      latitude: message.location.latitude,
      longitude: message.location.longitude,
      enabled: true,
    });
    const user = await getUser(chatId);
    const lang = user?.language || 'uk';
    const weatherData = await getRainForecast(message.location.latitude, message.location.longitude, chatId);
    const settings = await getUserSettings(chatId);
    const label = await locationLabel(chatId, message.location.latitude, message.location.longitude);
    const w = formatWeatherMessage(weatherData, lang, settings, label);
    const savedPrefix = `<b>${t(lang, 'location_saved')}</b>`;
    const result = await sendWithFallback(chatId, `${savedPrefix}\n\n${w.rich}`, { reply_markup: mainMenuKeyboard(lang) }, `${savedPrefix}\n\n${w.plain}`);
    if (result.ok) {
      await saveUser(chatId, { last_message_id: result.result.message_id });
    }
    return;
  }

  // Handle pending API key input
  if (pendingCallbacks[chatId]?.action === 'api_key') {
    const { provider } = pendingCallbacks[chatId];
    delete pendingCallbacks[chatId];

    const user = await getUser(chatId);
    const lang = user?.language || 'uk';
    const providerNames = { weatherapi: 'WeatherAPI.com', owm: 'OpenWeatherMap', rainbow: 'Rainbow Weather' };
    const providerName = providerNames[provider] || provider;

    if (!text || text.length < 10) {
      await sendWithFallback(chatId, t(lang, 'api_key_too_short'), { reply_markup: mainMenuKeyboard(lang) });
      return;
    }

    await saveUserApiKey(chatId, provider, text.trim());
    const keys = await getAllUserApiKeys(chatId);
    const activeProviders = keys.map(k => k.provider);
    await sendWithFallback(chatId, `${t(lang, 'api_key_saved')} ${providerName}`, { reply_markup: apiKeysKeyboard(lang, activeProviders) });
    return;
  }

  // Handle pending location name for multi-location
  if (pendingCallbacks[chatId]?.action === 'location_name') {
    const user = await getUser(chatId);
    const lang = user?.language || 'uk';
    if (message.location) {
      const lat = message.location.latitude;
      const lon = message.location.longitude;
      delete pendingCallbacks[chatId];
      await addUserLocation(chatId, t(lang, 'set_locations'), lat, lon);
      const locations = await getUserLocations(chatId);
      await sendWithFallback(chatId, t(lang, 'location_saved_success'), {
        reply_markup: { remove_keyboard: true },
      });
      await sendWithFallback(chatId, `${t(lang, 'your_locations')}`, { reply_markup: locationsKeyboard(lang, locations) });
      return;
    }
    const locName = text?.trim();
    if (!locName || locName.length > 50) {
      await sendWithFallback(chatId, t(lang, 'name_too_long'));
      return;
    }
    pendingCallbacks[chatId] = { action: 'location_coords', name: locName, messageId: pendingCallbacks[chatId].messageId };
    await sendWithFallback(chatId, `📍 ${t(lang, 'location_add_prompt')}: "${locName}"`, {
      reply_markup: {
        keyboard: [[{ text: `📍 ${t(lang, 'send_geolocation')}`, request_location: true }]],
        one_time_keyboard: true,
        resize_keyboard: true,
      },
    });
    return;
  }

  // Handle pending location coordinates for multi-location
  if (pendingCallbacks[chatId]?.action === 'location_coords') {
    const { name } = pendingCallbacks[chatId];
    delete pendingCallbacks[chatId];
    const user = await getUser(chatId);
    const lang = user?.language || 'uk';

    let lat, lon;
    if (message.location) {
      lat = message.location.latitude;
      lon = message.location.longitude;
    } else if (text) {
      const parts = text.split(',').map(s => parseFloat(s.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        lat = parts[0];
        lon = parts[1];
      }
    }

    if (lat == null || lon == null) {
      await sendWithFallback(chatId, `${t(lang, 'error_name_empty')}. ${t(lang, 'location_add_prompt')}:`, {
        reply_markup: {
          keyboard: [[{ text: `📍 ${t(lang, 'send_geolocation')}`, request_location: true }]],
          one_time_keyboard: true,
          resize_keyboard: true,
        },
      });
      return;
    }

    await addUserLocation(chatId, name, lat, lon);
    const user2 = await getUser(chatId);
    const lang2 = user2?.language || 'uk';
    const locations = await getUserLocations(chatId);
    await sendWithFallback(chatId, `✅ ${t(lang2, 'location_saved_success')} "${name}"`, {
      reply_markup: { remove_keyboard: true },
    });
    await sendWithFallback(chatId, `${t(lang2, 'your_locations')}`, { reply_markup: locationsKeyboard(lang2, locations) });
    return;
  }

  const user = await getUser(chatId);
  const lang = user?.language || 'uk';
  await sendWithFallback(chatId, t(lang, 'send_location_prompt'), { reply_markup: mainMenuKeyboard(lang) });
}

// === Auto-Update (Cron) ===
async function updateAllUsers() {
  const users = await getAllUsers();
  let updated = 0;

  for (const user of users) {
    if (!user.chat_id) continue;

    const lang = user.language || 'uk';
    const settings = await getUserSettings(user.chat_id);
    const locations = await getUserLocations(user.chat_id);

    for (const loc of locations) {
      if (!loc.latitude || !loc.last_message_id) continue;
      try {
        const weatherData = await getRainForecast(loc.latitude, loc.longitude, user.chat_id);
        const locLabel = await locationLabel(user.chat_id, loc.latitude, loc.longitude);
        const msg = formatWeatherMessage(weatherData, lang, settings, locLabel);
        const result = await editWithFallback(user.chat_id, loc.last_message_id, msg.rich, {
          reply_markup: mainMenuKeyboard(lang),
        }, msg.plain);
        if (result.ok) {
          updated++;
        } else {
          console.warn(`Edit failed for ${user.chat_id} loc ${loc.id}: ${JSON.stringify(result)}`);
        }
      } catch (err) {
        console.error(`Update error for ${user.chat_id} loc ${loc.id}:`, err.message);
      }
    }
  }
  return updated;
}

// Resolve a human-friendly label for a location: prefer the user's saved
// name from user_locations (matched by nearest coordinates), else show coords.
async function locationLabel(chatId, lat, lon) {
  try {
    const locs = await getUserLocations(chatId);
    if (locs && locs.length) {
      let best = null, bestDist = Infinity;
      for (const l of locs) {
        if (l.latitude == null || l.longitude == null) continue;
        const d = (l.latitude - lat) ** 2 + (l.longitude - lon) ** 2;
        if (d < bestDist) { bestDist = d; best = l; }
      }
      if (best && bestDist < 0.0004 && best.name) {
        return `📍 ${best.name}`;
      }
    }
  } catch (e) {
    console.warn('locationLabel failed:', e.message);
  }
  return `📍 ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

// === Cron Check: edit existing + send new ONLY on rain transition ===
async function checkAllUsers() {
  const users = await getAllUsers();
  let edited = 0, alertsSent = 0;

  for (const user of users) {
    if (!user.chat_id) continue;

    const settings = await getUserSettings(user.chat_id);
    const lang = user.language || 'uk';

    // Each saved location is monitored independently (multi-location support).
    const locations = await getUserLocations(user.chat_id);
    if (!locations.length) continue;

    for (const loc of locations) {
      if (!loc.latitude) continue;
      const locId = loc.id;
      try {
        const wasRaining = loc.last_rain_state || false;
        const lastMessageId = loc.last_message_id || 0;
        const lastAlert = loc.last_alert_time || 0;
        const lastAdvanceWarn = Number(loc.last_advance_warn_ms) || 0;

        const weatherData = await getRainForecast(loc.latitude, loc.longitude, user.chat_id);
        const locLabel = await locationLabel(user.chat_id, loc.latitude, loc.longitude);

        // Quiet hours check
        if (settings?.quiet_hours_start && settings?.quiet_hours_end) {
          const now = new Date();
          const [sh, sm] = settings.quiet_hours_start.split(':').map(Number);
          const [eh, em] = settings.quiet_hours_end.split(':').map(Number);
          const nowMin = now.getHours() * 60 + now.getMinutes();
          const startMin = sh * 60 + sm;
          const endMin = eh * 60 + em;
          let inQuiet = false;
          if (startMin <= endMin) {
            inQuiet = nowMin >= startMin && nowMin < endMin;
          } else {
            inQuiet = nowMin >= startMin || nowMin < endMin;
          }
          if (inQuiet) continue;
        }

        const lookaheadMs = (settings?.lookahead_min || 30) * 60 * 1000;
        const threshold = settings?.rain_threshold_mm || 0.5;
        const cooldownMs = (settings?.alert_cooldown_min || 30) * 60 * 1000;

        const rainSoon = weatherData.minutely?.some(m =>
          m.ms > weatherData.nowLocalMs &&
          m.ms < weatherData.nowLocalMs + lookaheadMs &&
          m.precip_mm >= threshold
        );
        let needsRainAlert = weatherData.isRaining || rainSoon;

        // User-provided OWM key => OWM is authoritative and unconditional.
        const owmAuthoritative = weatherData.hasOwmKey && weatherData.rainSignals.includes('OWM-authoritative');

        // Additional threshold checks (skipped when OWM is authoritative)
        if (!owmAuthoritative && needsRainAlert && weatherData.current) {
          if (settings?.wind_threshold_kmh && weatherData.current.wind_speed < settings.wind_threshold_kmh) {
            needsRainAlert = false;
          }
          if (settings?.humidity_threshold_pct && weatherData.current.humidity < settings.humidity_threshold_pct) {
            needsRainAlert = false;
          }
          if (settings?.temp_threshold_c != null && weatherData.current.temp_c > settings.temp_threshold_c) {
            needsRainAlert = false;
          }
        }
        if (owmAuthoritative) needsRainAlert = true;

        // Debounce: check if rain state changed from last check (per location)
        const rainTransition = needsRainAlert && !wasRaining;

        // Update rain state for THIS location in DB
        await updateUserLocationState(user.chat_id, locId, { last_rain_state: needsRainAlert });

        const msg = formatWeatherMessage(weatherData, lang, settings, locLabel);

        // ALWAYS edit existing message (silent update, like /update)
        if (lastMessageId) {
          const editResult = await editWithFallback(user.chat_id, lastMessageId, msg.rich, {
            reply_markup: mainMenuKeyboard(lang),
          }, msg.plain);
          if (editResult.ok) edited++;
        }

        // Send NEW message ONLY on rain transition (triggers notification)
        if (rainTransition && Date.now() - lastAlert > cooldownMs) {
          const sendResult = await sendWithFallback(user.chat_id, msg.rich, { reply_markup: mainMenuKeyboard(lang) }, msg.plain);
          if (sendResult.ok) {
            await updateUserLocationState(user.chat_id, locId, {
              last_alert_time: Date.now(),
              last_message_id: sendResult.result.message_id,
            });
            alertsSent++;
          }
        }

        // Round up: advance warning for rain hours/days ahead (once per rain event)
        const earlyWarnH = Number(settings?.early_warn_hours) || 0;
        if (earlyWarnH > 0 && weatherData.forecast?.length) {
          const earlyWarnHorizon = weatherData.nowLocalMs + earlyWarnH * 3600 * 1000;
          const advanceGapMs = Math.max(lookaheadMs, 60 * 60 * 1000);
          let earliestRainStart = null;
          for (const h of weatherData.forecast) {
            if (h.ms > weatherData.nowLocalMs + advanceGapMs && h.ms <= earlyWarnHorizon && h.precip_mm >= threshold) {
              if (earliestRainStart === null || h.ms < earliestRainStart) earliestRainStart = h.ms;
            }
          }
          if (earliestRainStart) {
            const alreadyWarned = lastAdvanceWarn > 0 && Math.abs(earliestRainStart - lastAdvanceWarn) < 30 * 60 * 1000;
            if (!alreadyWarned) {
              const advItem = weatherData.forecast.find(h => h.ms === earliestRainStart);
              const hoursAway = Math.round((earliestRainStart - weatherData.nowLocalMs) / 3600000);
              const advDate = formatDate(advItem.timeStr, lang, weatherData.tzOffsetMs, advItem.ms);
              const advTime = localTimeStr(advItem.ms, weatherData.tzOffsetMs);
              const recAdv = settings?.posture === 'outside' ? t(lang, 'advance_rain_outside') : t(lang, 'advance_rain_inside');
              const advMsg = `<b>☔ ${t(lang, 'advance_rain_title')}</b>\n\n${locLabel}\n${t(lang, 'advance_rain_msg', { date: advDate, time: advTime, hours: hoursAway })}\n\n${recAdv}`;
              const advSend = await sendWithFallback(user.chat_id, advMsg, {});
              if (advSend.ok) {
                await updateUserLocationState(user.chat_id, locId, { last_advance_warn_ms: earliestRainStart });
                alertsSent++;
              }
            }
          }
        }

        // === Experimental factual-rain trajectory alert (opt-in) ===
        // Samples actual current OWM observations around the location (not a
        // forecast): if it is really raining within the chosen radius and the
        // cloud-motion vector (850 hPa, falling back to surface wind) carries
        // the rain toward the user, warn with an ETA. Dedup by
        // exp_trajectory_last_ms + a 45-minute cooldown.
        // Fires only while rain is NOT here yet (advance notice).
        if (settings?.exp_trajectory === true && !needsRainAlert) {
          try {
            const traj = await detectRainTrajectory(loc.latitude, loc.longitude, user.chat_id, settings?.exp_radius_km);
            if (traj && traj.motion) {
              const hit = pickBestInterception(
                traj.cells,
                { lat: loc.latitude, lon: loc.longitude },
                traj.motion
              );
              if (hit && hit.etaMinutes >= 5) {
                const lastExp = Number(loc.exp_trajectory_last_ms) || 0;
                const quietDedup = Date.now() - lastExp;
                if (quietDedup > Math.max(cooldownMs, 45 * 60 * 1000)) {
                  const isSnow = hit.snowMm || (traj.userTempC != null && traj.userTempC < 2 && hit.mm > 0);
                  const fromName = windDirName(lang, hit.fromDeg);
                  const expMsg =
                    `<b>${t(lang, isSnow ? 'exp_alert_title_snow' : 'exp_alert_title')}</b>\n\n${locLabel}\n` +
                    `${t(lang, 'exp_alert_body', { km: hit.distanceKm, eta: hit.etaMinutes })}\n\n` +
                    `${t(lang, 'exp_alert_direction', { dir: fromName, bearing: hit.distanceKm })}\n\n` +
                    `⏳ ~${hit.etaMinutes} ${t(lang, 'unit_min')} ${t(lang, 'exp_alert_calc')}`;
                  const expSend = await sendWithFallback(user.chat_id, expMsg, {});
                  if (expSend.ok) {
                    await updateUserLocationState(user.chat_id, locId, { exp_trajectory_last_ms: Date.now() });
                    alertsSent++;
                  }
                }
              }
            }
          } catch (e) {
            console.warn(`[EXP] trajectory failed for ${user.chat_id} loc ${locId}:`, e.message);
          }
        }
      } catch (err) {
        console.error(`Check error for ${user.chat_id} loc ${locId}:`, err.message);
      }
    }
  }
  return { edited, alertsSent };
}

// === Cloudflare Worker handlers (replaces http server + self-ping) ===

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleWebhook(update) {
  const result = { ok: true, handled: [] };
  if (update.message) {
    await handleMessage(update.message);
    result.handled.push('message');
  }
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    result.handled.push('callback_query');
  }
  return result;
}

export async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'POST' && path === '/webhook') {
    let update;
    try {
      update = await request.json();
    } catch (err) {
      return json({ ok: false, error: 'invalid json' }, 400);
    }
    try {
      return json(await handleWebhook(update));
    } catch (err) {
      console.error('Rain webhook error:', err.message);
      return json({ ok: false, error: err.message }, 500);
    }
  }

  if (request.method === 'GET' && (path === '/health' || path === '/')) {
    return json({ status: 'ok', bot: 'rain-alert-bot', route: 'rain' });
  }

  if (request.method === 'GET' && path === '/check') {
    try {
      const result = await checkAllUsers();
      return json({ ok: true, edited: result.edited, alertsSent: result.alertsSent });
    } catch (err) {
      return json({ ok: false, error: err.message }, 500);
    }
  }

  if (request.method === 'GET' && path === '/update') {
    try {
      const updated = await updateAllUsers();
      return json({ ok: true, updated });
    } catch (err) {
      return json({ ok: false, error: err.message }, 500);
    }
  }

  if (request.method === 'POST' && path === '/setup-webhook') {
    const body = await request.json().catch(() => ({}));
    const base = body.base_url || ENV.RAIN_WORKER_URL || '';
    if (!base) {
      return json({ ok: false, error: 'base_url required' }, 400);
    }
    const webhookUrl = `${base.replace(/\/$/, '')}/rain/webhook`;
    const result = await tgSetWebhook(webhookUrl);
    return json(result);
  }

  return json({ ok: false, error: 'not found' }, 404);
}

// Called by the Worker scheduled handler
export async function runScheduled() {
  await initDB();
  const result = await checkAllUsers();
  return result;
}
