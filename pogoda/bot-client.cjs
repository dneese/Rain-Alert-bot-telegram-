(() => {
  'use strict';

  // Telegram bot token from env (set via wrangler secret put BOT_TOKEN)
  const TOKEN = process.env.BOT_TOKEN || '';

  if (!TOKEN) {
    console.warn('[pogoda-bot-client] BOT_TOKEN not set — Telegram functions will fail.');
  }

  // Base API URL
  const API = `https://api.telegram.org/bot${TOKEN}`;

  // ---------- sendMessage ----------
  async function sendMessage(chatId, text, opts = {}) {
    const params = new URLSearchParams({
      chat_id: chatId,
      text: text,
      ...(opts.parse_mode ? { parse_mode: opts.parse_mode } : {}),
      ...(opts.disable_web_page_preview ? { disable_web_page_preview: 'true' } : {}),
    });
    const res = await fetch(`${API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`Telegram sendMessage: ${data.description}`);
    return data.result;
  }

  // ---------- sendRichMessage (markdown V2) ----------
  async function sendRichMessage(chatId, { markdown }) {
    // Telegram Bot API supports parse_mode 'Markdown' (V1) or 'MarkdownV2' (V2).
    // We use MarkdownV2 with escape of special chars, or fallback to plain text.
    // For simplicity, try MarkdownV2; on failure fallback to plain.
    const escaped = markdown
      .replace(/[_\\[\\]()~`>#+\-=|{}.!]/g, c => '\\' + c);
    try {
      return await sendMessage(chatId, escaped, { parse_mode: 'MarkdownV2' });
    } catch (e) {
      // Fallback: send as plain text (loses formatting but never fails)
      return await sendMessage(chatId, markdown, { parse_mode: null });
    }
  }

  // ---------- editMessageText (rich card edit) ----------
  async function editMessageText({ chat_id, message_id, markdown }) {
    const escaped = markdown
      .replace(/[_\\[\\]()~`>#+\-=|{}.!]/g, c => '\\' + c);
    const res = await fetch(`${API}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        chat_id,
        message_id,
        parse_mode: 'MarkdownV2',
        text: escaped,
      }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`Telegram editMessageText: ${data.description}`);
    return data.result;
  }

  // ---------- answerCallbackQuery ----------
  async function answerCallbackQuery(callbackQueryId, opts = {}) {
    const params = new URLSearchParams({
      callback_query_id: callbackQueryId,
      ...(opts.text ? { text: opts.text } : {}),
    });
    const res = await fetch(`${API}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`Telegram answerCallbackQuery: ${data.description}`);
    return data.result;
  }

  // ---------- Exported API ----------
  module.exports = {
    sendMessage,
    sendRichMessage,
    editMessageText,
    answerCallbackQuery,
  };
})();