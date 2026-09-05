// Rain-alert-bot standalone Cloudflare Worker entry
import { configure, handleRequest, runScheduled } from '../rain/rain-bot.js';

export default {
  async fetch(request, env, ctx) {
    configure(env);
    return handleRequest(request);
  },
  async scheduled(event, env, ctx) {
    configure(env);
    const result = await runScheduled();
    console.log('rain scheduled:', JSON.stringify(result));
    return new Response('OK', { status: 200 });
  }
};