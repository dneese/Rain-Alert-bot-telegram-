# weather-bots — Telegram Weather Alert Bots on Cloudflare Workers

**Сейчас работает бот [@PogodaAlert_bot](https://t.me/PogodaAlert_bot)**
(оповещения об опасных погодных явлениях: дождь, снег, ветер, жара, грозы).

В этом репозитории также хранится подготовка второго бота — `@AlertRain_bot`
(оповещение о дожде), воркер `rain-alert-bot` на Cloudflare Workers:

- обрабатывает `fetch` (Telegram webhook) и `scheduled` (крон `*/15 * * * *`),
- хранит пользователей/настройки/локации/API-ключи в Supabase (REST, anon key),
- использует Open-Meteo и опциональные API-ключи (WeatherAPI, OpenWeatherMap, Rainbow).

- обрабатывает `fetch` (Telegram webhook) и `scheduled` (крон `*/15 * * * *`),
- хранит пользователей/настройки/локации/API-ключи в Supabase (REST, anon key),
- использует Open-Meteo и опциональные API-ключи (WeatherAPI, OpenWeatherMap, Rainbow).

## Структура

```
weather-workers/
├── src/rain-only.js        # Entry point воркера (export default: fetch + scheduled)
├── rain/                   # Код rain-бота
│   ├── rain-bot.js         # handleRequest / runScheduled / handleWebhook
│   └── lib/
│       ├── db.js           # Supabase REST адаптер (configureDb(env), headers())
│       └── i18n.js         # Переводы (uk/en/ru/pl/de/fr)
├── scripts/
│   └── deploy-rain-worker.sh  # Деплой через Cloudflare REST API (без wrangler)
├── wrangler.rain.toml      # Конфиг для wrangler (альтернативный способ)
├── pogoda/                 # Второй бот (погода) — не деплоится, справочно
├── worker-src.js           # Старый монолит (rain+pogoda) — справочно
└── wrangler.toml           # Старый конфиг обоих ботов
```

## Деплой через REST API (работает из Termux/Linux, без wrangler)

wrangler не работает на Android/Termux (`workerd: Unsupported platform`), поэтому
используется официальный Cloudflare REST API — curl + multipart upload.

Необходимо:

- Cloudflare аккаунт, API-токен с правами «Workers Edit» (`CF_API_TOKEN`),
- account id (`CF_ACCOUNT_ID`),
- Telegram bot token (создать через `@BotFather`) и
- Supabase проект со схемой бота: таблицы `users`, `user_settings`,
  `user_api_keys`, `user_locations` (+ publishable/anon key и REST URL).

### 1. Сборка бандла (esbuild)

```bash
npm install          # esbuild (workerd/wrangler не нужны)
node node_modules/esbuild/bin/esbuild src/rain-only.js \
  --bundle --format=esm --platform=browser --target=es2022 \
  --outfile=dist/rain-bot-worker.js --external:node:zlib
```

Итоговый файл — `dist/rain-bot-worker.js` (в `.gitignore`).

### 2. Деплой

```bash
cd weather-workers
CF_API_TOKEN="<token>"
CF_ACCOUNT_ID="<account_id>"
TELEGRAM_BOT_TOKEN="<bot token>"

bash scripts/deploy-rain-worker.sh
```

Скрипт выполняет три шага через API:

1. `PUT /accounts/{id}/workers/scripts/rain-alert-bot` — загрузка модуля
   (`main_module` + биндинги: `TELEGRAM_BOT_TOKEN` (secret), `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, пустые `WEATHERAPI_KEY`/`OWM_KEY`/`RAINBOW_KEY`).
2. `PUT .../schedules` c телом `[{"cron":"*/15 * * * *"}]` — крон.
3. `POST .../subdomain` с телом `{"enabled":true}` — включение `*.workers.dev`.

> Важно: воркер должен экспортировать `export default { fetch, scheduled }`.
> Именованные экспорты (`export { fetch }`) привязывают маршрут workers.dev
> некорректно — сайт покажет «There is nothing here yet». Entry point уже в
> нужной форме.

Переменные воркера тоже можно задать вручную: `CF_WORKER_NAME`,
`SUPABASE_URL`, `SUPABASE_ANON_KEY`.

### 3. Настройка webhook Telegram

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://rain-alert-bot.<subdomain>.workers.dev/webhook"
```

Публичный URL: `https://rain-alert-bot.<account-subdomain>.workers.dev`
(account-subdomain берётся из `GET /accounts/{id}/workers/subdomain`).

Проверка: `GET https://.../health` → `{"status":"ok",...}`,
`getWebhookInfo` → `pending_update_count: 0`, без `last_error_message`.

## Альтернативный способ: wrangler (на ПК с обычной ОС)

```bash
npm install -D wrangler
wrangler login
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler deploy -c wrangler.rain.toml
```

`wrangler.rain.toml` уже содержит `name`, `main`, crons, `nodejs_compat` и
variables; `TELEGRAM_BOT_TOKEN` — только через `secret put`.

## Ограничения бесплатного тарифа

- 100 000 запросов/день,
- 10ms CPU-время на вызов (достаточно),
- 5 cron-триггеров (используется 1).

## Как вернуть секреты безопасно

`TELEGRAM_BOT_TOKEN` хранится в Cloudflare как `secret_text` биндинг — он
зашивается платформой и не попадает в git. В репозиторий не коммитить API
токены, ключи Supabase `sb_secret_*` и токены ботов. При публикации
форка/копии задавайте собственные значения через env при запуске скрипта.