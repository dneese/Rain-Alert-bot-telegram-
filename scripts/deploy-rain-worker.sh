#!/usr/bin/env bash
set -euo pipefail

# Deploy rain-alert-bot worker to Cloudflare via REST API (no wrangler).
# Required env:
#   CF_API_TOKEN      Cloudflare API token (Workers Edit permission)
#   CF_ACCOUNT_ID     Cloudflare account id
#   TELEGRAM_BOT_TOKEN rain bot token
# Optional:
#   CF_WORKER_NAME    worker name (default: rain-alert-bot)
#   WEATHERAPI_KEY / OWM_KEY / RAINBOW_KEY  fallback weather keys

CF_API_TOKEN="${CF_API_TOKEN:-}"
CF_ACCOUNT_ID="${CF_ACCOUNT_ID:-}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
WORKER_NAME="${CF_WORKER_NAME:-rain-alert-bot}"
SUPABASE_URL="${SUPABASE_URL:-https://ljavyrmgcepwximavjyz.supabase.co}"
# NOTE: never hardcode SUPABASE_SERVICE_ROLE here (it's a secret). Set it as an env var.
SUPABASE_SERVICE_ROLE="${SUPABASE_SERVICE_ROLE:-}"

if [ -z "$CF_API_TOKEN" ] || [ -z "$CF_ACCOUNT_ID" ] || [ -z "$TELEGRAM_BOT_TOKEN" ]; then
  echo "ERROR: set CF_API_TOKEN, CF_ACCOUNT_ID, TELEGRAM_BOT_TOKEN" >&2
  exit 1
fi
if [ -z "${SUPABASE_SERVICE_ROLE}" ]; then
  echo "ERROR: set SUPABASE_SERVICE_ROLE (Supabase service role key)" >&2
  exit 1
fi

BUNDLE="dist/rain-bot-worker.js"
WORKER_NAME_ESCAPED=$(printf '%s' "$WORKER_NAME" | jq -R .)
TOKEN_ESCAPED=$(printf '%s' "$TELEGRAM_BOT_TOKEN" | jq -R .)

METADATA=$(cat <<JSON
{
  "main_module": "rain-bot-worker.js",
  "compatibility_date": "2025-01-01",
  "compatibility_flags": ["nodejs_compat"],
  "bindings": [
    { "type": "secret_text", "name": "TELEGRAM_BOT_TOKEN", "text": $TOKEN_ESCAPED },
    { "type": "plain_text", "name": "SUPABASE_URL", "text": "$SUPABASE_URL" },
    { "type": "secret_text", "name": "SUPABASE_SERVICE_ROLE", "text": "$SUPABASE_SERVICE_ROLE" },
    { "type": "plain_text", "name": "WEATHERAPI_KEY", "text": "${WEATHERAPI_KEY:-}" },
    { "type": "plain_text", "name": "OWM_KEY", "text": "${OWM_KEY:-}" },
    { "type": "plain_text", "name": "RAINBOW_KEY", "text": "${RAINBOW_KEY:-}" }
  ]
}
JSON
)

echo "== Uploading worker: $WORKER_NAME"
curl -sS -X PUT \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -F "metadata=$METADATA;type=application/json" \
  -F "rain-bot-worker.js=@$BUNDLE;type=application/javascript+module" \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/workers/scripts/$WORKER_NAME"

echo ""
echo "== Setting cron trigger (*/15 * * * *)"
curl -sS -X PUT \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"cron":"*/15 * * * *"}]' \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/workers/scripts/$WORKER_NAME/schedules"

echo ""
echo "== Enabling workers.dev subdomain for worker"
curl -sS -X POST \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled":true}' \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/workers/scripts/$WORKER_NAME/subdomain"

echo ""
echo "== Done. Get the worker URL:"
echo "  https://$WORKER_NAME.<account-subdomain>.workers.dev"