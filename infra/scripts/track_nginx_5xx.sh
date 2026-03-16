#!/usr/bin/env bash
set -euo pipefail

BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-/etc/novinzhstroy/backend.env}"
ACCESS_LOG_FILE="${ACCESS_LOG_FILE:-/var/log/nginx/access.log}"
ALERT_STATE_DIR="${ALERT_STATE_DIR:-/run/novinzhstroy-alerts}"
ALERT_LOG_FILE="${ALERT_LOG_FILE:-/var/log/novinzhstroy-error-tracker/events.ndjson}"
SERVICE_NAME="${SERVICE_NAME:-novinzhstroy-nginx}"
APP_SYSTEM_USER="${APP_SYSTEM_USER:-novin}"
APP_SYSTEM_GROUP="${APP_SYSTEM_GROUP:-${APP_SYSTEM_USER}}"
RUN_MODE="${1:-}"

if [ -f "$BACKEND_ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$BACKEND_ENV_FILE"
  set +a
fi

TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
ALERT_TELEGRAM_CHAT_IDS="${ALERT_TELEGRAM_CHAT_IDS:-}"
ALERT_COOLDOWN_SECONDS="${ALERT_COOLDOWN_SECONDS:-300}"
HOST_NAME="$(hostname -f 2>/dev/null || hostname)"

install -d -m 0700 "$ALERT_STATE_DIR"
install -d -o "$APP_SYSTEM_USER" -g "$APP_SYSTEM_GROUP" -m 0750 "$(dirname "$ALERT_LOG_FILE")"
if [ ! -f "$ALERT_LOG_FILE" ]; then
  install -o "$APP_SYSTEM_USER" -g "$APP_SYSTEM_GROUP" -m 0640 /dev/null "$ALERT_LOG_FILE"
fi

is_5xx_status() {
  case "$1" in
    5??) return 0 ;;
    *) return 1 ;;
  esac
}

should_notify() {
  local dedupe_key="$1"
  local state_key=""
  local state_file=""
  local now_epoch=0
  local last_epoch=0

  state_key="$(printf '%s' "$dedupe_key" | tr -c '[:alnum:].@_-' '_')"
  state_file="${ALERT_STATE_DIR}/${state_key}.stamp"
  now_epoch="$(date +%s)"

  if [ -f "$state_file" ]; then
    last_epoch="$(cat "$state_file" 2>/dev/null || printf '0')"
  fi

  if [ $((now_epoch - last_epoch)) -lt "$ALERT_COOLDOWN_SECONDS" ]; then
    return 1
  fi

  printf '%s' "$now_epoch" > "$state_file"
  return 0
}

build_payload_json() {
  local request_method="$1"
  local request_path="$2"
  local response_status="$3"
  local remote_addr="$4"
  local raw_line="$5"

  node - "$SERVICE_NAME" "$HOST_NAME" "$request_method" "$request_path" "$response_status" "$remote_addr" "$raw_line" <<'NODE'
const [service, host, method, requestPath, status, remoteAddr, rawLine] = process.argv.slice(2);
const payload = {
  timestamp: new Date().toISOString(),
  service,
  type: 'http_5xx',
  severity: 'critical',
  message: `nginx returned HTTP ${status}`,
  context: {
    source: 'nginx_access',
    host,
    method,
    path: requestPath,
    status: Number(status),
    remoteAddr,
    rawLine,
  },
};
process.stdout.write(JSON.stringify(payload));
NODE
}

append_payload_log() {
  local payload_json="$1"
  printf '%s\n' "$payload_json" >> "$ALERT_LOG_FILE"
}

send_webhook_alert() {
  local payload_json="$1"

  if [ -z "$ALERT_WEBHOOK_URL" ]; then
    return 0
  fi

  if ! curl --fail --silent --show-error \
    -H 'content-type: application/json' \
    --data "$payload_json" \
    "$ALERT_WEBHOOK_URL" >/dev/null; then
    printf 'nginx 5xx tracker: webhook delivery failed\n' >&2
  fi
}

send_telegram_alert() {
  local response_status="$1"
  local request_method="$2"
  local request_path="$3"
  local remote_addr="$4"

  if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$ALERT_TELEGRAM_CHAT_IDS" ]; then
    return 0
  fi

  local message=""
  message="$(cat <<EOF
Novinzhstroy Alert
Service: ${SERVICE_NAME}
Severity: CRITICAL
Type: http_5xx
Message: nginx returned HTTP ${response_status}
Host: ${HOST_NAME}
Method: ${request_method}
Path: ${request_path}
RemoteAddr: ${remote_addr}
Time: $(date -u '+%Y-%m-%dT%H:%M:%SZ')
EOF
)"

  local chat_id=""
  for chat_id in ${ALERT_TELEGRAM_CHAT_IDS//,/ }; do
    chat_id="$(printf '%s' "$chat_id" | xargs)"
    if [ -z "$chat_id" ]; then
      continue
    fi

    if ! curl --fail --silent --show-error \
      --data-urlencode "chat_id=${chat_id}" \
      --data-urlencode "text=${message}" \
      --data "disable_web_page_preview=true" \
      "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" >/dev/null; then
      printf 'nginx 5xx tracker: Telegram delivery failed\n' >&2
    fi
  done
}

process_access_line() {
  local line="$1"
  local access_log_regex='^([^[:space:]]+) [^"]*"([A-Z]+) ([^[:space:]]+) HTTP/[^"]+" ([0-9]{3}) '
  local remote_addr=""
  local request_method=""
  local request_path=""
  local response_status=""
  local dedupe_path=""
  local dedupe_key=""
  local payload_json=""

  if [[ ! "$line" =~ $access_log_regex ]]; then
    return 0
  fi

  remote_addr="${BASH_REMATCH[1]}"
  request_method="${BASH_REMATCH[2]}"
  request_path="${BASH_REMATCH[3]}"
  response_status="${BASH_REMATCH[4]}"

  if ! is_5xx_status "$response_status"; then
    return 0
  fi

  payload_json="$(build_payload_json "$request_method" "$request_path" "$response_status" "$remote_addr" "$line")"
  append_payload_log "$payload_json"

  dedupe_path="${request_path%%\?*}"
  dedupe_key="nginx_http_5xx:${response_status}:${request_method}:${dedupe_path}"

  if ! should_notify "$dedupe_key"; then
    return 0
  fi

  send_webhook_alert "$payload_json"
  send_telegram_alert "$response_status" "$request_method" "$request_path" "$remote_addr"
}

run_from_stdin() {
  while IFS= read -r line; do
    process_access_line "$line"
  done
}

run_tail_follower() {
  if [ ! -f "$ACCESS_LOG_FILE" ]; then
    printf 'nginx 5xx tracker: access log not found: %s\n' "$ACCESS_LOG_FILE" >&2
    exit 1
  fi

  tail -n 0 -F "$ACCESS_LOG_FILE" | while IFS= read -r line; do
    process_access_line "$line"
  done
}

if [ "$RUN_MODE" = "--stdin" ]; then
  run_from_stdin
  exit 0
fi

run_tail_follower
