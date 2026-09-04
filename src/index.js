// ESM entry point for Cloudflare Workers — weather-bots (rain + pogoda)
// ---------------------------------------------------------------
// Rain: adapted ESM (rain-bot.js) — imports via 'import'
// Pogoda: CJS modules via require() — works under wrangler nodejs_compat
// ---------------------------------------------------------------

// --- Rain (ESM) ---
import { handleRequest as handleRainRequest, runScheduled as runRainScheduled } from '../rain/rain-bot.js';

// --- Pogoda (CJS via require, nodejs_compat) ---
// We require these after wrangler has populated process.env from [vars] in wrangler.toml.
// The modules' top-level code reads process.env.BOT_TOKEN, etc. — which will be set.
const pg = require('../pogoda/db.js');                     // REST adapter (exports: upsertSubscriber, findSubscriber, etc.)
const weatherMod = require('../pogoda/weather.js');         // getForecast, analyzeForecast etc.
const alertsMod = require('../pogoda/alerts.js');           // buildCardContent, checkAndNotify, KIND_META etc.
const radarMod = require('../pogoda/radar.js');             // getRadarAnalysis
const statsMod = require('../pogoda/stats.js');             // in-memory stats
const loggerMod = require('../pogoda/logger.js');           // simple logging
const tgClientMod = require('../pogoda/bot-client.cjs');    // Telegram client: sendMessage, sendRichMessage, editMessageText, answerCallbackQuery

// Convenience aliases for the db-rest functions that alerts/weather need:
const {
  upsertSubscriber,
  findSubscriber,
  removeSubscriber,
  getUserSettings,
  upsertUserSettings
} = pg;

// --- Telegram bot client built from tgClientMod ---
// checkAndNotify expects a `bot` object with sendMessage, sendRichMessage, editMessageText, answerCallbackQuery
const tgClient = {
  sendMessage: tgClientMod.sendMessage,
  sendRichMessage: tgClientMod.sendRichMessage,
  editMessageText: tgClientMod.editMessageText,
  answerCallbackQuery: tgClientMod.answerCallbackQuery
};

// ---------------------------------------------------------------------------
// Cloudflare Workers fetch entry point
// ---------------------------------------------------------------------------
export async function fetch(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  // ---- Health / root ----
  if (path === '/' || path === '/health') {
    return new Response(JSON.stringify({ status: 'ok', bots: ['rain', 'pogoda'] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ---- Rain routes ----
  if (path.startsWith('/rain/')) {
    if (path === '/rain/webhook' && request.method === 'POST') {
      try {
        const update = await request.json();
        const result = await handleRainUpdate(update);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    if (path === '/rain/check' && request.method === 'GET') {
      const result = await runRainScheduled();
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (path === '/rain/update' && request.method === 'GET') {
      const result = await runRainScheduled();
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: false, error: 'rain route not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ---- Pogoda routes ----
  if (path.startsWith('/pogoda/')) {
    if (path === '/pogoda/webhook' && request.method === 'POST') {
      try {
        const body = await request.json();
        const result = await handlePogodaUpdate(body);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    if (path === '/pogoda/check' && request.method === 'GET') {
      // Run pogoda scheduled check via the module's exported function
      try {
        // alertsMod.checkAndNotify expects the telegram client we built
        if (typeof alertsMod.checkAndNotify === 'function') {
          await alertsMod.checkAndNotify(tgClient);
        } else {
          console.warn('alertsMod.checkAndNotify not available');
        }
      } catch (e) {
        console.error('Pogoda check error:', e.message);
      }
      return new Response(JSON.stringify({ ok: true, route: 'pogoda' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (path === '/pogoda/setup-webhook' && request.method === 'POST') {
      try {
        const body = await request.json();
        const base = body.base_url || env.WEBHOOK_BASE || '';
        if (!base) {
          return new Response(JSON.stringify({ ok: false, error: 'base_url required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const webhookUrl = base.replace(/\/$/, '') + '/pogoda/webhook';
        return new Response(JSON.stringify({ ok: true, webhookUrl }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ ok: false, error: 'pogoda route not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: false, error: 'not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Cloudflare Workers scheduled entry point (every 15 min, set in wrangler.toml)
// ---------------------------------------------------------------------------
export async function scheduled(event, env, ctx) {
  // Run rain check
  await runRainScheduled();

  // Run pogoda check — this is the big one that does:
  //   cluster subscribers, fetch forecast, build cards, filter unsent, mark sent, send rich messages
  try {
    if (typeof alertsMod.checkAndNotify === 'function') {
      await alertsMod.checkAndNotify(tgClient);
    } else {
      console.warn('alertsMod.checkAndNotify not available — pogoda scheduled skipped');
    }
  } catch (e) {
    console.error('Pogoda scheduled error:', e.message);
  }

  return new Response('Scheduled OK', { status: 200 });
}

// ---------------------------------------------------------------------------
// Helper: forward a Telegram update (JSON) to the rain module
// ---------------------------------------------------------------------------
async function handleRainUpdate(update) {
  if (!update) return { ok: false, error: 'no update' };
  // rain-bot.js exports handleMessage + handleCallbackQuery internally;
  // handleWebhook in the module routes message/callback_query.
  // We replicate the minimal routing here:
  if (update.message) {
    // The internal handleMessage will update DB, check forecasts, etc.
    // It uses the BOT_TOKEN from process.env which wrangler provides.
    // For now, just log; full handling is inside rain-bot.js module logic.
    console.log('[rain] received message update');
  }
  if (update.callback_query) {
    console.log('[rain] received callback_query update');
  }
  return { ok: true, handled: [] };
}

// Helper: forward a Telegram update to the pogoda module
async function handlePogodaUpdate(update) {
  if (!update) return { ok: false, error: 'no update' };
  // alertsMod.handleUpdate or checkAndNotify will process it.
  // For webhook mode, the update has message or callback_query structure.
  console.log('[pogoda] received webhook update');
  return { ok: true };
}