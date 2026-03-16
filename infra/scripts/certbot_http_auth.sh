#!/usr/bin/env bash
set -Eeuo pipefail

WEBROOT="${NOVIN_TLS_WEBROOT:-/var/www/_letsencrypt}"
TOKEN="${CERTBOT_TOKEN:?CERTBOT_TOKEN is required}"
VALIDATION="${CERTBOT_VALIDATION:?CERTBOT_VALIDATION is required}"
CHALLENGE_DIR="${WEBROOT}/.well-known/acme-challenge"
CHALLENGE_FILE="${CHALLENGE_DIR}/${TOKEN}"

install -d -m 0755 "$CHALLENGE_DIR"
printf '%s' "$VALIDATION" >"$CHALLENGE_FILE"
