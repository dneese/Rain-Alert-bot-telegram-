// db-rest.cjs — Supabase REST adapter (no pg/PostGIS)
// Used by pogoda modules (weather, alerts, bot) via require()
// Reads from process.env.SUPABASE_ANON_KEY and process.env.SUPABASE_SERVICE_ROLE
// Both set via wrangler secret put

(() => {
  'use strict';

  // Supabase endpoint base — project subdomain from wrangler vars
  const SUPABASE_PROJECT = 'zabqvbtfsdasbnyfvchu'; // pogoda project
  const SUPABASE_URL = `https://${SUPABASE_PROJECT}.supabase.co`;
  const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE || '';

  // Choose key: service key for writes, anon for reads
  function getKey(forWrite = false) {
    return (forWrite && SERVICE_KEY) ? SERVICE_KEY : ANON_KEY;
  }

  const headers = (forWrite = false) => {
    const key = getKey(forWrite);
    return {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  };

  // ---------- Helpers ----------
  async function request(method, endpoint, bodyOrParams = {}, forWrite = false) {
    const key = getKey(forWrite);
    if (!key) throw new Error(`Supabase key missing for ${endpoint}`);
    const headers_ = {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    // Add Prefer header for upserts that return representation
    if (!forWrite) {
      headers_.Prefer = 'return=representation';
    }
    const url = new URL(`/rest/v1${endpoint}`, SUPABASE_URL);
    // Apply any param filtering from object
    if (typeof bodyOrParams === 'object' && !Array.isArray(bodyOrParams)) {
      const search = new URLSearchParams();
      for (const [k, v] of Object.entries(bodyOrParams)) {
        if (v !== undefined && v !== null) search.append(k, String(v));
      }
      url.search = search.toString();
    }
    const body = bodyOrParams && !Array.isArray(bodyOrParams) && Object.keys(bodyOrParams).length
      ? JSON.stringify(bodyOrParams)
      : undefined;

    const opts = {
      method,
      headers: headers_,
      body,
    };
    const res = await fetch(url, opts);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Supabase ${method} ${res.status}: ${text}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  // ---------- Subscribers ----------
  async function upsertSubscriber(chatId, chatType, lat, lon) {
    // chatType: 'private' | 'group' | 'supergroup'
    const locationGeo = JSON.stringify({ type: 'Point', coordinates: [lon, lat] });
    const data = {
      chat_id: chatId,
      chat_type: chatType,
      location: locationGeo,
    };
    return request('POST', 'subscribers', data, true); // write
  }

  async function findSubscriber(chatId) {
    const data = await request('GET', `subscribers?chat_id=eq.${chatId}&select=*`);
    return data && data.length ? data[0] : null;
  }

  async function removeSubscriber(chatId) {
    return request('DELETE', `subscribers?chat_id=eq.${chatId}`, {}, true);
  }

  // ---------- User settings ----------
  async function getUserSettings(chatId) {
    const data = await request('GET', `user_settings?chat_id=eq.${chatId}&select=*`);
    return data && data.length ? data[0] : null;
  }

  async function upsertUserSettings(chatId, partial) {
    const data = await request('POST', `user_settings`, { chat_id: chatId, ...partial }, true);
    return data;
  }

  // ---------- Forecast cache ----------
  async function getForecastEntry(clusterKey) {
    const data = await request('GET', `forecast_cache?cluster_key=eq.${clusterKey}&select=payload,fetched_at`);
    return data && data.length ? data[0] : null;
  }

  async function setCachedForecast(clusterKey, locationGeoJSON, payload) {
    // locationGeoJSON is already {type:'Point',coordinates:[lon,lat]}
    const data = await request('POST', 'forecast_cache', {
      cluster_key: clusterKey,
      location: locationGeoJSON,
      payload: payload,
    }, true);
    return data;
  }

  // ---------- Sent alerts (batch dedup) ----------
  async function filterUnsentSubscribers(chatIds, kind, eventStartISO) {
    // chatIds: array of BIGINT
    // kind: string enum 'rain'|'thunder'|'urgent'|...
    // eventStartISO: ISO string of the event start time
    const chatIdList = chatIds.map(id => String(id)).join(',');
    const params = {
      alert_kind: kind,
      event_start: eventStartISO,
      chat_id: `in.(${chatIdList})`,
    };
    const data = await request('GET', `sent_alerts`, params, false);
    // Return chat_ids that were NOT sent already
    const sentIds = new Set((data || []).map(r => r.chat_id));
    return chatIds.filter(cid => !sentIds.has(cid));
  }

  async function markAlertsSentBatch(chatIds, kind, eventStartISO) {
    const chatIdList = chatIds.map(id => String(id));
    const data = await request('POST', 'sent_alerts', {
      chat_id: chatIdList,
      alert_kind: kind,
      event_start: eventStartISO,
    }, true);
    return data;
  }

  // ---------- Chat messages (rich cards) ----------
  async function upsertChatMessage(chatId, messageId, contentHash) {
    const data = await request('POST', 'chat_messages', {
      chat_id: chatId,
      message_id: messageId,
      content_hash: contentHash,
    }, true);
    return data;
  }

  async function getChatMessages(chatIds) {
    const chatIdList = chatIds.map(id => String(id)).join(',');
    const data = await request('GET', `chat_messages?chat_id=in.(${chatIdList})&select=*`);
    return data || [];
  }

  // ---------- User settings batch ----------
  async function getSettingsForChats(chatIds) {
    const chatIdList = chatIds.map(id => String(id)).join(',');
    const data = await request('GET', `user_settings?chat_id=in.(${chatIdList})&select=*`);
    return data || [];
  }

  // ---------- Subscriber count ----------
  async function getSubscriberCount() {
    const data = await request('GET', `users?select=chat_id&count=exact`, {}, false);
    // Supabase returns count in header 'content-range' or as property depending on version
    // For safety, just return length of fetched rows
    return (data && Array.isArray(data) ? data.length : 0);
  }

  // ---------- Cleanup old data ----------
  async function cleanupOldData() {
    // Delete sent_alerts older than 2 days
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    await request('POST', 'cleanup_old_data', {}, true); // relies on DB function
    // Alternatively run raw SQL via rpc if needed, but we assume the function exists.
  }

  // ---------- Exported API (must match pogoda-repo/db.js exports) ----------
  module.exports = {
    upsertSubscriber,
    findSubscriber,
    removeSubscriber,
    getUserSettings,
    upsertUserSettings: upsertUserSettings,
    getForecastEntry,
    setCachedForecast,
    filterUnsentSubscribers,
    markAlertsSentBatch,
    upsertChatMessage,
    getChatMessages,
    getSettingsForChats,
    getSubscriberCount,
    cleanupOldData,
  };
})();