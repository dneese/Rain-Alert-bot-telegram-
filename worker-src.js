// ESM entry point for Cloudflare Workers — weather-bots (rain + pogoda)
// ---------------------------------------------------------------
import { handleRequest as handleRainRequest, runScheduled as runRainScheduled } from '../rain/rain-bot.js';

let pogodaMod = null;

async function initPogoda(env) {
  if (pogodaMod) return;
  if (!globalThis.process) globalThis.process = {};
  if (!globalThis.process.env) globalThis.process.env = {};
  globalThis.process.env.TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN || '';
  globalThis.process.env.BOT_TOKEN = env.BOT_TOKEN || '';
  globalThis.process.env.USE_POLLING = env.USE_POLLING !== undefined ? String(env.USE_POLLING) : 'false';
  globalThis.process.env.RATE_LIMIT_MSGS = env.RATE_LIMIT_MSGS || '20';
  globalThis.process.env.RADAR_CACHE_TTL_MS = env.RADAR_CACHE_TTL_MS || '3600000';
  globalThis.process.env.CHECK_CRON = env.CHECK_CRON || '*/15 * * * *';
  try {
    const mod = await import('../pogoda/bot-client.cjs');
    pogodaMod = mod;
  } catch(e) { console.error('Pogoda init error:', e.message); }
}

async function handleRainUpdate(update) {
  if (!update) return { ok: false, error: 'no update' };
  if (update.message) console.log('[rain] received message update');
  if (update.callback_query) console.log('[rain] received callback_query update');
  return { ok: true, handled: [] };
}

async function handlePogodaUpdate(update) {
  if (!update) return { ok: false, error: 'no update' };
  console.log('[pogoda] received webhook update');
  return { ok: true };
}

export async function fetch(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === '/' || path === '/health') {
    return new Response(JSON.stringify({ status: 'ok', bots: ['rain', 'pogoda'] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (path.startsWith('/rain/')) {
    if (path === '/rain/webhook' && request.method === 'POST') {
      try { const update = await request.json(); return new Response(JSON.stringify(await handleRainUpdate(update)), { headers: { 'Content-Type': 'application/json' } }); } catch(e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 400, headers: { 'Content-Type': 'application/json' } }); } }
    }
    if (path === '/rain/check' && request.method === 'GET') { const result = await runRainScheduled(); return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } }); }
    if (path === '/rain/update' && request.method === 'GET') { const result = await runRainScheduled(); return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } }); }
    return new Response(JSON.stringify({ ok: false, error: 'rain route not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  if (path.startsWith('/pogoda/')) {
    if (path === '/pogoda/webhook' && request.method === 'POST') {
      try { const body = await request.json(); return new Response(JSON.stringify(await handlePogodaUpdate(body)), { headers: { 'Content-Type': 'application/json' } }); } catch(e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 400, headers: { 'Content-Type': 'application/json' } }); } }
    }
    if (path === '/pogoda/check' && request.method === 'GET') {
      try { if (typeof alertsMod.checkAndNotify === 'function') { await alertsMod.checkAndNotify(tgClient); } } catch(e) { console.error('Pogoda check error:', e.message); }
      return new Response(JSON.stringify({ ok: true, route: 'pogoda' }), { headers: { 'Content-Type': 'application/json' } }); }
    if (path === '/pogoda/setup-webhook' && request.method === 'POST') {
      try { const body = await request.json(); const base = body.base_url || env.WEBHOOK_BASE || ''; return new Response(JSON.stringify({ ok: true, webhookUrl: base.replace(/\/$/, '') + '/pogoda/webhook' }), { headers: { 'Content-Type': 'application/json' } }); } catch(e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 400, headers: { 'Content-Type': 'application/json' } }); } }
    }
    return new Response(JSON.stringify({ ok: false, error: 'pogoda route not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ ok: false, error: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
}

export async function scheduled(event, env, ctx) {
  await initPogoda(env);
  await runRainScheduled();
  try { if (typeof alertsMod.checkAndNotify === 'function') { await alertsMod.checkAndNotify(tgClient); } } catch(e) { console.error('Pogoda scheduled error:', e.message); }
  return new Response('Scheduled OK', { status: 200 });
}
