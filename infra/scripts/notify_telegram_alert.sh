#!/usr/bin/env bash
set -euo pipefail

BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-/etc/novinzhstroy/backend.env}"
UNIT_NAME="${1:-novinzhstroy-backend.service}"
ALERT_STATE_DIR="${ALERT_STATE_DIR:-/run/novinzhstroy-alerts}"

if [ -f "$BACKEND_ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$BACKEND_ENV_FILE"
  set +a
fi

TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
ALERT_TELEGRAM_CHAT_IDS="${ALERT_TELEGRAM_CHAT_IDS:-}"
ALERT_COOLDOWN_SECONDS="${ALERT_COOLDOWN_SECONDS:-300}"

if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$ALERT_TELEGRAM_CHAT_IDS" ]; then
  exit 0
fi

install -d -m 0700 "$ALERT_STATE_DIR"

state_key="$(printf '%s' "$UNIT_NAME" | tr -c '[:alnum:].@_-' '_')"
state_file="${ALERT_STATE_DIR}/${state_key}.stamp"
now_epoch="$(date +%s)"
last_epoch=0

if [ -f "$state_file" ]; then
  last_epoch="$(cat "$state_file" 2>/dev/null || printf '0')"
fi

if [ $((now_epoch - last_epoch)) -lt "$ALERT_COOLDOWN_SECONDS" ]; then
  exit 0
fi

printf '%s' "$now_epoch" > "$state_file"

host_name="$(hostname -f 2>/dev/null || hostname)"
unit_result="$(systemctl show "$UNIT_NAME" --property=Result --value 2>/dev/null || true)"
status_excerpt="$(systemctl status "$UNIT_NAME" --no-pager --full 2>/dev/null || true)"
status_excerpt="$(printf '%s\n' "$status_excerpt" | sed -n '1,12p')"

message="$(cat <<EOF
🚨 Novinzhstroy backend failure
Host: ${host_name}
Unit: ${UNIT_NAME}
Result: ${unit_result:-unknown}
Time: $(date -u '+%Y-%m-%dT%H:%M:%SZ')

${status_excerpt}
EOF
)"

for chat_id in ${ALERT_TELEGRAM_CHAT_IDS//,/ }; do
  chat_id="$(printf '%s' "$chat_id" | xargs)"
  if [ -z "$chat_id" ]; then
    continue
  fi

  curl --fail --silent --show-error \
    --data-urlencode "chat_id=${chat_id}" \
    --data-urlencode "text=${message}" \
    --data "disable_web_page_preview=true" \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" >/dev/null
done
