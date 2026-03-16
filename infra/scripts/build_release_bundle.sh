#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <bundle_dir>" >&2
  exit 1
fi

PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
BUNDLE_DIR="$1"

require_dir() {
  local dir_path="$1"
  if [ ! -d "$dir_path" ]; then
    echo "Required directory not found: $dir_path" >&2
    exit 1
  fi
}

require_dir "$PROJECT_ROOT"
require_dir "${PROJECT_ROOT}/frontend"
require_dir "${PROJECT_ROOT}/frontend/dist"
require_dir "${PROJECT_ROOT}/backend"
require_dir "${PROJECT_ROOT}/infra"

ensure_backend_toolchain() {
  local backend_dir="$1"

  if [ -x "${backend_dir}/node_modules/.bin/tsc" ]; then
    return 0
  fi

  if [ ! -f "${backend_dir}/package-lock.json" ]; then
    echo "package-lock.json missing in ${backend_dir}" >&2
    exit 1
  fi

  (cd "$backend_dir" && npm ci)
}

build_backend_dist() {
  local source_backend_dir="$1"
  local bundle_backend_dir="$2"
  local bundle_node_modules_link="${bundle_backend_dir}/node_modules"

  ensure_backend_toolchain "$source_backend_dir"

  rm -rf "${bundle_backend_dir}/dist"
  ln -s "${source_backend_dir}/node_modules" "$bundle_node_modules_link"

  if ! (cd "$bundle_backend_dir" && ./node_modules/.bin/tsc -p tsconfig.json); then
    rm -f "$bundle_node_modules_link"
    exit 1
  fi

  rm -f "$bundle_node_modules_link"
}

rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR/backend" "$BUNDLE_DIR/frontend" "$BUNDLE_DIR/frontend-dist" "$BUNDLE_DIR/infra"

rsync -a --delete \
  --exclude 'node_modules' \
  --exclude 'dist' \
  "${PROJECT_ROOT}/frontend/" "${BUNDLE_DIR}/frontend/"

rsync -a --delete "${PROJECT_ROOT}/frontend/dist/" "${BUNDLE_DIR}/frontend-dist/"

rsync -a --delete \
  --exclude 'node_modules' \
  --exclude '.data' \
  --exclude 'dist' \
  "${PROJECT_ROOT}/backend/" "${BUNDLE_DIR}/backend/"

build_backend_dist "${PROJECT_ROOT}/backend" "${BUNDLE_DIR}/backend"
rsync -a --delete "${PROJECT_ROOT}/infra/" "${BUNDLE_DIR}/infra/"

echo "Release bundle assembled at ${BUNDLE_DIR}"
