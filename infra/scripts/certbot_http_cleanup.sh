#!/usr/bin/env bash
set -Eeuo pipefail

WEBROOT="${NOVIN_TLS_WEBROOT:-/var/www/_letsencrypt}"
TOKEN="${CERTBOT_TOKEN:?CERTBOT_TOKEN is required}"
CHALLENGE_FILE="${WEBROOT}/.well-known/acme-challenge/${TOKEN}"

rm -f "$CHALLENGE_FILE"
