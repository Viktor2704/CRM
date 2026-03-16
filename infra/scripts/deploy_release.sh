#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <bundle_dir>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/release_runtime_common.sh
. "${SCRIPT_DIR}/release_runtime_common.sh"

BUNDLE_DIR="$1"
RELEASE_ID="${RELEASE_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
RELEASE_DIR="${RELEASES_DIR}/${RELEASE_ID}"

require_dir "$BUNDLE_DIR"
require_dir "${BUNDLE_DIR}/frontend"
require_dir "${BUNDLE_DIR}/frontend-dist"
require_dir "${BUNDLE_DIR}/backend"
require_dir "${BUNDLE_DIR}/infra"

mkdir -p "$RELEASE_DIR"
rsync -a --delete "${BUNDLE_DIR}/frontend/" "${RELEASE_DIR}/frontend/"
rsync -a --delete "${BUNDLE_DIR}/frontend-dist/" "${RELEASE_DIR}/frontend-dist/"
rsync -a --delete "${BUNDLE_DIR}/backend/" "${RELEASE_DIR}/backend/"
rsync -a --delete "${BUNDLE_DIR}/infra/" "${RELEASE_DIR}/infra/"

if [ -d "${BUNDLE_DIR}/backend-dist" ]; then
  rsync -a --delete "${BUNDLE_DIR}/backend-dist/" "${RELEASE_DIR}/backend-dist/"
fi

prepare_runtime_tree "$RELEASE_DIR"

if [ -L "${APP_ROOT}/current" ]; then
  current_target="$(readlink -f "${APP_ROOT}/current" || true)"
  if [ -n "$current_target" ] && [ -d "$current_target" ]; then
    ln -sfn "$current_target" "${APP_ROOT}/previous"
  fi
fi

ln -sfn "$RELEASE_DIR" "${APP_ROOT}/current"

systemctl restart "$BACKEND_SERVICE_NAME"
systemctl is-active --quiet "$BACKEND_SERVICE_NAME"
wait_for_ready

echo "Deployment successful. release_id=${RELEASE_ID}"
