import { fetchCurrentWeather, fetchHourlyForecast } from './weather.js';
import { getUser, getAllUsers, getUserLocations, getUserSettings, saveUserSettings } from './lib/db.js';
import { t } from './lib/i18n.js';

const WIND_DEFAULT = parseInt(process.env.WN3_WIND_THRESHOLD || '40', 10);
const RAIN_DEFAULT = parseInt(process.env.WN3_RAIN_THRESHOLD || '15', 10);
const HEAT_DEFAULT = parseInt(process.env.WN3_HEAT_THRESHOLD || '35', 10);
const COLD_DEFAULT = parseInt(process.env.WN3_COLD_THRESHOLD || '-20', 10);
const CHECK_INTERVAL_MS = parseInt(process.env.WN3_CHECK_INTERVAL_MS || '900000', 10);

let lastCheckTime = 0;

function formatLocalTime(tz) {
  try {
    return new Date().toLocaleTimeString('uk-UA', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  } catch {
    return new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }) + ' UTC';
  }
}

function windDirLabel(cardinal) {
  const map = {
    NORTH: '⬆️ Пн', SOUTH: '⬇️ Пд', EAST: '➡️ Сх', WEST: '⬅️ Зх',
    NORTHEAST: '↗️ ПнСх', NORTHWEST: '↖️ ПнЗ',
    SOUTHEAST: '↘️ ПдСх', SOUTHWEST: '↙️ ПдЗ',
  };
  return map[cardinal] || cardinal || '';
}

function buildWeatherMessage(current, locName, lang) {
  const lines = [];
  lines.push(`📍 <b>${locName}</b>\n`);
  lines.push(`🌡 Температура: ${Math.round(current.temperature)}°C (відчувається як ${Math.round(current.feelsLike)}°C)`);
  if (current.windSpeed != null) {
    const dir = windDirLabel(current.windDir);
    lines.push(`💨 Вітер: ${Math.round(current.windSpeed)} км/год ${dir}`);
    if (current.windGust && current.windGust > current.windSpeed * 1.3) {
      lines.push(`   Пориви: до ${Math.round(current.windGust)} км/год`);
    }
  }
  if (current.humidity != null) lines.push(`💧 Вологість: ${current.humidity}%`);
  if (current.cloudCover != null) lines.push(`☁️ Хмарність: ${current.cloudCover}%`);
  if (current.pressure != null) lines.push(`🔽 Тиск: ${Math.round(current.pressure)} гПа`);
  if (current.uvIndex != null) lines.push(`☀️ УФ-індекс: ${current.uvIndex}`);
  if (current.precipQpf > 0) lines.push(`🌧 Опади: ${current.precipQpf.toFixed(1)} мм`);
  if (current.condition) lines.push(`\n📌 ${current.condition}`);
  const tz = current.timeZone || 'Europe/Kyiv';
  lines.push(`\n🕐 ${formatLocalTime(tz)}`);
  lines.push(`📡 Google WeatherNext 3`);
  return lines.join('\n');
}

function severityEmoji(level) {
  if (level === 3) return '🔴';
  if (level === 2) return '🟠';
  if (level === 1) return '🟡';
  return '🟢';
}

function cardinalToUkrainian(cardinal) {
  const map = {
    NORTH: 'Пн', NORTH_NORTHWEST: 'ПнПнЗ', NORTH_NORTHEAST: 'ПнПнСх',
    NORTHEAST: 'ПнСх', EAST: 'Сх', SOUTHEAST: 'ПдСх',
    SOUTH: 'Пд', SOUTH_SOUTHWEST: 'ПдПдЗ', SOUTH_SOUTHEAST: 'ПдПдСх',
    SOUTHWEST: 'ПдЗ', WEST: 'Зх', NORTHWEST: 'ПнЗ',
    WEST_NORTHWEST: 'ЗхПнЗ', WEST_SOUTHWEST: 'ЗхПдЗ',
    EAST_NORTHEAST: 'СхПнСх', EAST_SOUTHEAST: 'СхПдСх',
  };
  return map[cardinal] || cardinal || '';
}

export function getThresholds(settings) {
  return {
    wind: settings?.wind_threshold ?? WIND_DEFAULT,
    rain: settings?.rain_threshold ?? RAIN_DEFAULT,
    heat: settings?.heat_threshold ?? HEAT_DEFAULT,
    cold: settings?.cold_threshold ?? COLD_DEFAULT,
  };
}

export function checkAlerts(current, thresholds) {
  const alerts = [];

  if (current.windSpeed != null && current.windSpeed >= thresholds.wind) {
    const level = current.windSpeed >= thresholds.wind * 1.5 ? 3 : current.windSpeed >= thresholds.wind * 1.2 ? 2 : 1;
    alerts.push({
      type: 'wind',
      level,
      message: `💨 ${severityEmoji(level)} Сильний вітер: ${Math.round(current.windSpeed)} км/год!`,
      header: '💨 ШТОРМОВИЙ ВІТЕР',
    });
  }

  if (current.precipQpf != null && current.precipQpf > 0) {
    const rate = current.precipQpf;
    if (rate >= thresholds.rain) {
      const level = rate >= thresholds.rain * 2 ? 3 : rate >= thresholds.rain * 1.5 ? 2 : 1;
      alerts.push({
        type: 'rain',
        level,
        message: `🌧 ${severityEmoji(level)} Сильний дощ: ${rate.toFixed(1)} мм/год!`,
        header: '🌧 ЗЛИВА',
      });
    }
  }

  if (current.temperature != null) {
    if (current.temperature >= thresholds.heat) {
      const level = current.temperature >= 40 ? 3 : current.temperature >= 37 ? 2 : 1;
      alerts.push({
        type: 'heat',
        level,
        message: `🔥 ${severityEmoji(level)} Спека: ${Math.round(current.temperature)}°C!`,
        header: '🔥 СПЕКА',
      });
    }
    if (current.temperature <= thresholds.cold) {
      const level = current.temperature <= -30 ? 3 : current.temperature <= -25 ? 2 : 1;
      alerts.push({
        type: 'cold',
        level,
        message: `🥶 ${severityEmoji(level)} Мороз: ${Math.round(current.temperature)}°C!`,
        header: '🥶 МОРОЗ',
      });
    }
  }

  if (current.thunderstormProb != null && current.thunderstormProb >= 70) {
    alerts.push({
      type: 'thunder',
      level: current.thunderstormProb >= 90 ? 3 : 2,
      message: `⛈ ${severityEmoji(current.thunderstormProb >= 90 ? 3 : 2)} Гроза: ймовірність ${current.thunderstormProb}%!`,
      header: '⛈ ГРОЗА',
    });
  }

  return alerts;
}

function formatLocationName(loc) {
  if (loc?.name) return loc.name;
  return `${loc?.latitude?.toFixed(2)}, ${loc?.longitude?.toFixed(2)}`;
}

async function processUserAlerts(tgClient, user) {
  const chatId = user.chat_id;
  const lang = user.lang || 'en';
  const settings = await getUserSettings(chatId);
  const locations = await getUserLocations(chatId);

  if (!locations || locations.length === 0) return;

  const thresholds = getThresholds(settings);
  const defaultLoc = locations.find(l => l.is_default) || locations[0];

  try {
    const current = await fetchCurrentWeather(defaultLoc.latitude, defaultLoc.longitude, lang);

    // Auto-update existing weather message
    if (settings?.auto_update && settings?.last_weather_msg_id && settings?.last_weather_chat_id) {
      const locName = settings.last_weather_loc || formatLocationName(defaultLoc);
      const newText = buildWeatherMessage(current, locName, lang);
      try {
        await tgClient.editMessage(settings.last_weather_chat_id, settings.last_weather_msg_id, newText, { parse_mode: 'HTML' });
      } catch (e) {
        // Message not modified or deleted — clear the reference
        if (e.message?.includes('message is not modified') || e.message?.includes('MESSAGE_ID_INVALID') || e.message?.includes('message to edit not found')) {
          await saveUserSettings(chatId, { last_weather_msg_id: 0 });
        }
      }
    }

    // Check and send alerts
    const alerts = checkAlerts(current, thresholds);
    if (alerts.length > 0) {
      const locName = formatLocationName(defaultLoc);
      let msg = `⚠️ <b>ПОПЕРЕДЖЕННЯ</b> — ${locName}\n\n`;
      for (const a of alerts) {
        msg += `${a.message}\n`;
      }
      msg += `\n🕐 ${formatLocalTime(current.timeZone || 'Europe/Kyiv')}`;

      await tgClient.sendMessage(chatId, msg, {
        parse_mode: 'HTML',
      });
    }
  } catch (e) {
    console.error(`[wn3/alerts] Error checking ${chatId}: ${e.message}`);
  }
}

export async function checkAndNotify(tgClient) {
  const now = Date.now();
  if (now - lastCheckTime < CHECK_INTERVAL_MS) return { skipped: true };
  lastCheckTime = now;

  let users;
  try {
    users = await getAllUsers();
  } catch (e) {
    console.error('[wn3/alerts] DB error:', e.message);
    return { error: e.message };
  }

  if (!users || users.length === 0) return { processed: 0 };

  let processed = 0;
  for (const user of users) {
    if (!user.alerts_enabled) continue;
    try {
      await processUserAlerts(tgClient, user);
      processed++;
    } catch (e) {
      console.error(`[wn3/alerts] User ${user.chat_id} error: ${e.message}`);
    }
  }

  return { processed };
}
