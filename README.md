# Weather Bots — Cloudflare Workers Migration

## Overview
Migration of Telegram weather bots (rain-alert-bot + pogoda-bot) from PandaStack to Cloudflare Workers Free tier.

## Architecture
- **Single Worker** with one cron trigger `*/15 * * * *` (every 15 minutes)
- **Rain bot**: adapted from `rain-bot.js` — uses Supabase REST (anon key) for user DB
- **Pogoda bot**: uses custom REST adapter (`pogoda/db.js`) without `pg` — Supabase project `zabqvbtfsdasbnyfvchu`
- **One cron**, one deploy — well within Free tier limits (100K req/day, 10ms CPU, 5 cron triggers)

## Project Structure
```
weather-workers/
├── wrangler.toml      # Config with [vars] — set via `wrangler secret put`
├── worker-src.js      # Main worker code (fetch + scheduled)
├── src/index.js       # ESM entry point
├── package.json
├── README.md
├── rain/
│   ├── rain-bot.js    # Adapted ESM (node:zlib, configure(env), exported handlers)
│   └── lib/
│       ├── db.js      # Supabase anon key reads
│       └── i18n.js    # 198KB ESM translations (verbatim)
└── pogoda/
    ├── weather.js     # Verbatim (getForecast, analyzeForecast etc.)
    ├── alerts.js      # Verbatim (checkAndNotify, buildCardContent, KIND_META)
    ├── radar.js       # Verbatim (getRadarAnalysis)
    ├── stats.js       # Verbatim (in-memory counters)
    ├── logger.js      # Verbatim (simple logging)
    ├── db.js          # REST adapter (14 functions: upsertSubscriber, etc.)
    └── bot-client.cjs # Telegram client (sendMessage, sendRichMessage, editMessageText, answerCallbackQuery)
```

## Quick Deploy (Dashboard — recommended)

1. Go to https://dash.cloudflare.com → login (kikikiska@gmail.com)
2. **Workers → Create Service** → name: `weather-bots`
3. **Quick edit** → paste all code from `worker-src.js`
4. **Settings → Variables** — add these variables:
   - `TELEGRAM_BOT_TOKEN` — rain bot token
   - `BOT_TOKEN` — `8883331647:AAFerI2sfcDnhYnnYXq6rxQAEZ5QdEOdh8s` (pogoda)
   - `SUPABASE_ANON_KEY` — `sb_publishable_duxI3Q3PHuo3WBe_xNCRqA_Krzfrfni`
   - `SUPABASE_SERVICE_ROLE` — `sb_publishable_w8mle2GHp_xOTw9hdrX_6A_-2uycK5E`
   - `WEBHOOK_BASE` — `https://weather-bots.xyz` (your domain)
   - `CHECK_CRON` — `*/15 * * * *`
   - `RADAR_CACHE_TTL_MS` — `3600000`
5. **Deploy**
6. After deploy, copy the worker URL (e.g. `weather-bots.xxx.workers.dev`)
7. Set Telegram webhooks:
   - Rain: `https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<worker-url>/rain/webhook`
   - Pogoda: `https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<worker-url>/pogoda/webhook`

## Manual Deploy (wrangler CLI — if you have npm on PC)

```bash
npm install -g wrangler
wrangler login          # browser login
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put BOT_TOKEN              # 8883331647:...
wrangler secret put SUPABASE_ANON_KEY      # sb_publishable_duxI3Q3PHuo3WBe_xNCRqA_Krzfrfni
wrangler secret put SUPABASE_SERVICE_ROLE  # sb_publishable_w8mle2GHp_xOTw9hdrX_6A_-2uycK5E
wrangler secret put WEBHOOK_BASE           # https://...
wrangler deploy
```

## Cost
- **$0 / month** — Cloudflare Workers Free tier:
  - 100K requests / day
  - 10ms CPU / invocation
  - 5 cron triggers (we use 1)
  - No hibernation needed — always on within limits

## Files Modified from Original
- `rain/rain-bot.js` — removed `http.createServer`, added `node:zlib`, env shim via `configure(env)`, exported `handleRequest` / `runScheduled`
- `pogoda/db.js` — new: REST adapter without `pg` (uses `SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE`)
- `pogoda/bot-client.cjs` — new: Telegram client (MarkdownV2 fallback)
- `src/index.js` — new: ESM entry with routing + scheduled
- `wrangler.toml` — updated with vos variables + `nodejs_compat`
- `worker-src.js` — snapshot of worker code for Dashboard upload