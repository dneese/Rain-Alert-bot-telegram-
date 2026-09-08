#!/usr/bin/env bash
set -euo pipefail

# Deploy WN3-mini (personal weather alert bot) worker to Cloudflare via REST API
# Required env:
#   CF_API_TOKEN      Cloudflare API token (Workers + D1 Edit permission)
#   CF_ACCOUNT_ID     Cloudflare account id
#   WN3_BOT_TOKEN     Telegram bot token
#   GOOGLE_WEATHER_API_KEY  Google Maps Weather API key
# Optional:
#   CF_WORKER_NAME    worker name (default: weather-bots-wn3-mini)
#   WN3_D1_DB_ID      D1 database ID
#   MY_CHAT_ID        owner Telegram ID (auto-learned from first message if empty)
#   LATITUDE / LONGITUDE / LOCATION_NAME  default location

CF_API_TOKEN="${CF_API_TOKEN:-}"
CF_ACCOUNT_ID="${CF_ACCOUNT_ID:-}"
WN3_BOT_TOKEN="${WN3_BOT_TOKEN:-}"
GOOGLE_WEATHER_API_KEY="${GOOGLE_WEATHER_API_KEY:-}"
WORKER_NAME="${CF_WORKER_NAME:-weather-bots-wn3-mini}"
WN3_D1_DB_ID="${WN3_D1_DB_ID:-}"
MY_CHAT_ID="${MY_CHAT_ID:-}"
LATITUDE="${LATITUDE:-}"
LONGITUDE="${LONGITUDE:-}"
LOCATION_NAME="${LOCATION_NAME:-}"
CRON="${WN3_CRON:-*/15 * * * *}"

if [ -z "$CF_API_TOKEN" ] || [ -z "$CF_ACCOUNT_ID" ]; then
  echo "ERROR: set CF_API_TOKEN and CF_ACCOUNT_ID" >&2
  exit 1
fi
if [ -z "$WN3_BOT_TOKEN" ]; then
  echo "ERROR: set WN3_BOT_TOKEN" >&2
  exit 1
fi
if [ -z "$GOOGLE_WEATHER_API_KEY" ]; then
  echo "ERROR: set GOOGLE_WEATHER_API_KEY" >&2
  exit 1
fi

# Ensure D1 database exists (create if WN3_D1_DB_ID not provided)
if [ -z "$WN3_D1_DB_ID" ]; then
  echo "== D1 database ID not provided, creating wn3-mini-db..."
  RESULT=$(curl -s -X POST \
    "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/d1/database" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data '{"name":"wn3-mini-db"}')
  WN3_D1_DB_ID=$(echo "$RESULT" | jq -r '.result.id // empty')
  if [ -z "$WN3_D1_DB_ID" ]; then
    echo "ERROR creating D1 database:" >&2
    echo "$RESULT" | jq . >&2
    exit 1
  fi
  echo "D1 created: $WN3_D1_DB_ID (export WN3_D1_DB_ID=$WN3_D1_DB_ID to reuse)"
fi

# Bundle with esbuild
echo "Bundling..."
node node_modules/esbuild/bin/esbuild wn3/bot-mini.js \
  --bundle \
  --format=esm \
  --outfile=dist/worker-wn3-mini.js \
  --minify \
  2>&1

TOKEN_ESCAPED=$(printf '%s' "$WN3_BOT_TOKEN" | jq -R .)
KEY_ESCAPED=$(printf '%s' "$GOOGLE_WEATHER_API_KEY" | jq -R .)
CHAT_ESCAPED=$(printf '%s' "$MY_CHAT_ID" | jq -R .)
LAT_ESCAPED=$(printf '%s' "$LATITUDE" | jq -R .)
LON_ESCAPED=$(printf '%s' "$LONGITUDE" | jq -R .)
NAME_ESCAPED=$(printf '%s' "$LOCATION_NAME" | jq -R .)

VAR_BINDINGS=""
[ -n "$MY_CHAT_ID" ] && VAR_BINDINGS="$VAR_BINDINGS, { \"type\": \"text\", \"name\": \"MY_CHAT_ID\", \"text\": $CHAT_ESCAPED }"
[ -n "$LATITUDE" ] && VAR_BINDINGS="$VAR_BINDINGS, { \"type\": \"text\", \"name\": \"LATITUDE\", \"text\": $LAT_ESCAPED }"
[ -n "$LONGITUDE" ] && VAR_BINDINGS="$VAR_BINDINGS, { \"type\": \"text\", \"name\": \"LONGITUDE\", \"text\": $LON_ESCAPED }"
[ -n "$LOCATION_NAME" ] && VAR_BINDINGS="$VAR_BINDINGS, { \"type\": \"text\", \"name\": \"LOCATION_NAME\", \"text\": $NAME_ESCAPED }"

METADATA=$(cat <<JSON
{
  "main_module": "worker-wn3-mini.js",
  "compatibility_date": "2025-01-01",
  "compatibility_flags": ["nodejs_compat"],
  "bindings": [
    { "type": "secret_text", "name": "WN3_BOT_TOKEN", "text": $TOKEN_ESCAPED },
    { "type": "secret_text", "name": "GOOGLE_WEATHER_API_KEY", "text": $KEY_ESCAPED },
    { "type": "d1", "name": "DB", "database_id": "$WN3_D1_DB_ID" }${VAR_BINDINGS}
  ]
}
JSON
)

echo "Deploying $WORKER_NAME to Cloudflare Workers..."
RESULT=$(curl -s -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/workers/scripts/$WORKER_NAME" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -F "metadata=$METADATA;type=application/json" \
  -F "worker-wn3-mini.js=@dist/worker-wn3-mini.js;type=application/javascript+module")

echo "$RESULT" | jq .
SUCCESS=$(echo "$RESULT" | jq -r '.success // false')
if [ "$SUCCESS" != "true" ]; then
  echo "DEPLOY FAILED" >&2
  exit 1
fi

echo ""
echo "== Setting cron trigger ($CRON)"
curl -sS -X PUT \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "[{\"cron\":\"$CRON\"}]" \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/workers/scripts/$WORKER_NAME/schedules" | jq .

echo ""
echo "== Enabling workers.dev subdomain"
curl -sS -X POST \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled":true}' \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/workers/scripts/$WORKER_NAME/subdomain" >/dev/null 2>&1

echo ""
echo "== Fetching account subdomain"
SUB=$(curl -s \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/workers/subdomain" | jq -r '.result.subdomain // empty')

WORKER_URL="https://${WORKER_NAME}.${SUB}.workers.dev"
echo "Worker URL: $WORKER_URL"

echo ""
echo "== Setting Telegram webhook"
curl -s "https://api.telegram.org/bot${WN3_BOT_TOKEN}/setWebhook?url=${WORKER_URL}/webhook&drop_pending_updates=true" | jq .

echo ""
echo "Done! Webhook -> $WORKER_URL/webhook"