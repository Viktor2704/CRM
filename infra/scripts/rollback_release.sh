#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/release_runtime_common.sh
. "${SCRIPT_DIR}/release_runtime_common.sh"

TARGET_RELEASE_ID="${1:-}"

if [ -n "$TARGET_RELEASE_ID" ]; then
  TARGET_RELEASE_DIR="${RELEASES_DIR}/${TARGET_RELEASE_ID}"
else
  if [ ! -L "${APP_ROOT}/previous" ]; then
    echo "No previous release symlink found and no release ID provided" >&2
    exit 1
  fi
  TARGET_RELEASE_DIR="$(readlink -f "${APP_ROOT}/previous")"
fi

require_dir "$TARGET_RELEASE_DIR"
prepare_runtime_tree "$TARGET_RELEASE_DIR"

if [ -L "${APP_ROOT}/current" ]; then
  current_target="$(readlink -f "${APP_ROOT}/current" || true)"
  if [ -n "$current_target" ] && [ -d "$current_target" ]; then
    ln -sfn "$current_target" "${APP_ROOT}/previous"
  fi
fi

ln -sfn "${TARGET_RELEASE_DIR}" "${APP_ROOT}/current"

systemctl restart "$BACKEND_SERVICE_NAME"
systemctl is-active --quiet "$BACKEND_SERVICE_NAME"
wait_for_ready

echo "Rollback successful. target_release=${TARGET_RELEASE_DIR##*/}"
