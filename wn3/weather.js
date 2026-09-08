let API_KEY = '';
let TIMEOUT_MS = 15000;

export function configureWeather(env) {
  env = env || {};
  if (env.GOOGLE_WEATHER_API_KEY) API_KEY = env.GOOGLE_WEATHER_API_KEY;
  if (env.WEATHER_TIMEOUT_MS) TIMEOUT_MS = parseInt(env.WEATHER_TIMEOUT_MS, 10);
}

const BASE = 'https://weather.googleapis.com/v1';

async function weatherGet(path, params = {}) {
  const qs = new URLSearchParams({ key: API_KEY, ...params }).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}?${qs}`, { signal: controller.signal });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Weather API ${res.status}: ${txt.slice(0, 200)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCurrentWeather(lat, lon, lang = 'en') {
  const data = await weatherGet('/currentConditions:lookup', {
    'location.latitude': lat,
    'location.longitude': lon,
    languageCode: lang,
    unitsSystem: 'METRIC',
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
    timeZone: data.timeZone?.id ?? null,
  };
}

export async function fetchHourlyForecast(lat, lon, hours = 24, lang = 'en') {
  const data = await weatherGet('/forecast/hours:lookup', {
    'location.latitude': lat,
    'location.longitude': lon,
    languageCode: lang,
    unitsSystem: 'METRIC',
    hours: Math.min(hours, 240),
  });
  return (data.forecastHours || []).map(h => ({
    startTime: h.interval?.startTime ?? null,
    hour: h.displayDateTime?.hours ?? null,
    day: h.displayDateTime?.day ?? null,
    month: h.displayDateTime?.month ?? null,
    isDaytime: h.isDaytime ?? true,
    temperature: h.temperature?.degrees ?? null,
    feelsLike: h.feelsLikeTemperature?.degrees ?? null,
    humidity: h.relativeHumidity ?? null,
    windSpeed: h.wind?.speed?.value ?? null,
    windGust: h.wind?.gust?.value ?? null,
    windDir: h.wind?.direction?.cardinal ?? null,
    cloudCover: h.cloudCover ?? null,
    pressure: h.airPressure?.meanSeaLevelMillibars ?? null,
    uvIndex: h.uvIndex ?? null,
    visibility: h.visibility?.distance ?? null,
    condition: h.weatherCondition?.description?.text ?? null,
    conditionType: h.weatherCondition?.type ?? null,
    iconUri: h.weatherCondition?.iconBaseUri ?? null,
    precipProb: h.precipitation?.probability?.percent ?? 0,
    precipType: h.precipitation?.probability?.type ?? null,
    precipQpf: h.precipitation?.qpf?.quantity ?? 0,
    thunderstormProb: h.thunderstormProbability ?? 0,
  }));
}

export async function fetchDailyForecast(lat, lon, days = 7, lang = 'en') {
  const data = await weatherGet('/forecast/days:lookup', {
    'location.latitude': lat,
    'location.longitude': lon,
    languageCode: lang,
    unitsSystem: 'METRIC',
    days: Math.min(days, 10),
  });
  return (data.forecastDays || []).map(d => {
    const dd = d.displayDate;
    const dateStr = dd ? `${dd.year}-${String(dd.month).padStart(2,'0')}-${String(dd.day).padStart(2,'0')}` : null;
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
      sunset: d.sunEvents?.sunsetTime ?? null,
    };
  });
}

export async function fetchWeatherAlerts(lat, lon, lang = 'en') {
  try {
    const data = await weatherGet('/alerts:lookup', {
      'location.latitude': lat,
      'location.longitude': lon,
      languageCode: lang,
    });
    return (data.weatherAlerts || []).map(a => ({
      severity: a.severity ?? null,
      title: a.title ?? null,
      description: a.description?.text ?? null,
      eventTime: a.eventTime ?? null,
      issuerName: a.issuerName ?? null,
    }));
  } catch (e) {
    if (e.message.includes('404') || e.message.includes('NOT_FOUND')) return [];
    throw e;
  }
}
