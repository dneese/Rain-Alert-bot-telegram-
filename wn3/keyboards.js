import { t } from './lib/i18n.js';

export function mainMenuKeyboard(lang) {
  return {
    inline_keyboard: [
      [{ text: t(lang, 'btn_weather'), callback_data: 'wn3_weather' }],
      [{ text: t(lang, 'btn_forecast'), callback_data: 'wn3_forecast' }],
      [{ text: t(lang, 'btn_alerts'), callback_data: 'wn3_alerts' }],
      [{ text: t(lang, 'btn_settings'), callback_data: 'wn3_settings' }],
      [{ text: t(lang, 'btn_location'), callback_data: 'wn3_location' }],
    ],
  };
}

export function settingsKeyboard(lang, alertsEnabled, autoUpdate = true) {
  return {
    inline_keyboard: [
      [{ text: `🔔 Сповіщення — ${alertsEnabled ? '✅' : '❌'}`, callback_data: 'wn3_toggle_alerts' }],
      [{ text: `🔄 Автооновлення — ${autoUpdate ? '✅' : '❌'}`, callback_data: 'wn3_toggle_auto_update' }],
      [{ text: t(lang, 'language_label'), callback_data: 'wn3_lang' }],
      [{ text: t(lang, 'btn_add_location'), callback_data: 'wn3_add_loc' }],
      [{ text: t(lang, 'settings_wind'), callback_data: 'wn3_set_wind' }],
      [{ text: t(lang, 'settings_rain'), callback_data: 'wn3_set_rain' }],
      [{ text: t(lang, 'settings_heat'), callback_data: 'wn3_set_heat' }],
      [{ text: t(lang, 'settings_cold'), callback_data: 'wn3_set_cold' }],
      [{ text: t(lang, 'btn_back'), callback_data: 'wn3_main' }],
    ],
  };
}

export function forecastDaysKeyboard(lang) {
  return {
    inline_keyboard: [
      [{ text: '1️⃣', callback_data: 'wn3_fc_1' }],
      [{ text: '3️⃣', callback_data: 'wn3_fc_3' }],
      [{ text: '5️⃣', callback_data: 'wn3_fc_5' }],
      [{ text: '7️⃣', callback_data: 'wn3_fc_7' }],
      [{ text: '🔟', callback_data: 'wn3_fc_10' }],
      [{ text: t(lang, 'btn_back'), callback_data: 'wn3_main' }],
    ],
  };
}

export function languageKeyboard(lang) {
  return {
    inline_keyboard: [
      [{ text: `${lang === 'uk' ? '✅ ' : ''}🇺🇦 Українська`, callback_data: 'wn3_lang_uk' }],
      [{ text: `${lang === 'en' ? '✅ ' : ''}🇬🇧 English`, callback_data: 'wn3_lang_en' }],
      [{ text: `${lang === 'ru' ? '✅ ' : ''}🇷🇺 Русский`, callback_data: 'wn3_lang_ru' }],
      [{ text: `${lang === 'pl' ? '✅ ' : ''}🇵🇱 Polski`, callback_data: 'wn3_lang_pl' }],
      [{ text: t(lang, 'btn_back'), callback_data: 'wn3_settings' }],
    ],
  };
}

export function windThresholdKeyboard(lang, current) {
  const options = [15, 20, 30, 40, 50, 60, 70, 80];
  return {
    inline_keyboard: [
      options.map(v => ({ text: `${v === current ? '✅ ' : ''}${v}`, callback_data: `wn3_wind_${v}` })),
      [{ text: t(lang, 'btn_back'), callback_data: 'wn3_settings' }],
    ],
  };
}

export function rainThresholdKeyboard(lang, current) {
  const options = [1, 3, 5, 10, 15, 20, 30, 50];
  return {
    inline_keyboard: [
      options.map(v => ({ text: `${v === current ? '✅ ' : ''}${v}`, callback_data: `wn3_rain_${v}` })),
      [{ text: t(lang, 'btn_back'), callback_data: 'wn3_settings' }],
    ],
  };
}

export function heatThresholdKeyboard(lang, current) {
  const options = [30, 33, 35, 37, 39, 40, 42, 45];
  return {
    inline_keyboard: [
      options.map(v => ({ text: `${v === current ? '✅ ' : ''}${v}`, callback_data: `wn3_heat_${v}` })),
      [{ text: t(lang, 'btn_back'), callback_data: 'wn3_settings' }],
    ],
  };
}

export function coldThresholdKeyboard(lang, current) {
  const options = [-5, -10, -15, -20, -25, -30, -35, -40];
  return {
    inline_keyboard: [
      options.map(v => ({ text: `${v === current ? '✅ ' : ''}${v}`, callback_data: `wn3_cold_${v}` })),
      [{ text: t(lang, 'btn_back'), callback_data: 'wn3_settings' }],
    ],
  };
}
