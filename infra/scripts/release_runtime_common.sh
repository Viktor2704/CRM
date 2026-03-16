#!/usr/bin/env bash

APP_ROOT="${APP_ROOT:-/srv/novinzhstroy}"
RELEASES_DIR="${RELEASES_DIR:-${APP_ROOT}/releases}"
SHARED_DIR="${SHARED_DIR:-${APP_ROOT}/shared}"
UPLOADS_DIR="${UPLOADS_DIR:-${SHARED_DIR}/uploads}"
SHARED_NODE_MODULES_DIR="${SHARED_NODE_MODULES_DIR:-${SHARED_DIR}/node_modules}"
APP_SYSTEM_USER="${APP_SYSTEM_USER:-novin}"
APP_SYSTEM_GROUP="${APP_SYSTEM_GROUP:-${APP_SYSTEM_USER}}"
BACKEND_SERVICE_NAME="${BACKEND_SERVICE_NAME:-novinzhstroy-backend}"
READY_URL="${READY_URL:-http://127.0.0.1:8080/ready}"
READY_RETRIES="${READY_RETRIES:-30}"
READY_DELAY_SECONDS="${READY_DELAY_SECONDS:-1}"
RUNUSER_BIN="${RUNUSER_BIN:-$(command -v runuser || true)}"
SHA256_BIN="${SHA256_BIN:-$(command -v sha256sum || true)}"

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

require_dir() {
  local dir_path="$1"

  [ -d "$dir_path" ] || fail "Required directory not found: $dir_path"
}

require_file() {
  local file_path="$1"

  [ -f "$file_path" ] || fail "Required file not found: $file_path"
}

require_bin() {
  local bin_path="$1"
  local bin_name="$2"

  if [ -z "$bin_path" ] || [ ! -x "$bin_path" ]; then
    fail "${bin_name} is required"
  fi
}

run_as_app_user() {
  if [ "$(id -un)" = "$APP_SYSTEM_USER" ]; then
    "$@"
    return
  fi

  require_bin "$RUNUSER_BIN" "runuser"
  "$RUNUSER_BIN" -u "$APP_SYSTEM_USER" -- "$@"
}

backend_lock_hash() {
  local lockfile_path="$1"

  require_bin "$SHA256_BIN" "sha256sum"
  "$SHA256_BIN" "$lockfile_path" | cut -d ' ' -f 1
}

install_backend_dependency_cache() {
  local package_json_path="$1"
  local package_lock_path="$2"
  local temp_dir="$3"

  install -o "$APP_SYSTEM_USER" -g "$APP_SYSTEM_GROUP" -m 0644 "$package_json_path" "${temp_dir}/package.json"
  install -o "$APP_SYSTEM_USER" -g "$APP_SYSTEM_GROUP" -m 0644 "$package_lock_path" "${temp_dir}/package-lock.json"

  run_as_app_user env HOME="$temp_dir" npm ci --omit=dev --prefix "$temp_dir"
}

ensure_backend_dependency_cache() {
  local backend_dir="$1"
  local package_json_path="${backend_dir}/package.json"
  local package_lock_path="${backend_dir}/package-lock.json"
  local release_node_modules_path="${backend_dir}/node_modules"
  local lock_hash=""
  local cache_dir=""
  local cache_node_modules_path=""
  local temp_dir=""

  require_file "$package_json_path"
  require_file "$package_lock_path"

  lock_hash="$(backend_lock_hash "$package_lock_path")"
  cache_dir="${SHARED_NODE_MODULES_DIR}/backend-${lock_hash}"
  cache_node_modules_path="${cache_dir}/node_modules"

  install -d -o "$APP_SYSTEM_USER" -g "$APP_SYSTEM_GROUP" "$SHARED_DIR" "$SHARED_NODE_MODULES_DIR"

  # Keep dependency installation outside the release tree so deploy/rollback do not
  # repopulate code directories with root-owned node_modules.
  if [ ! -d "$cache_node_modules_path" ]; then
    temp_dir="$(mktemp -d "${SHARED_NODE_MODULES_DIR}/backend-${lock_hash}.tmp.XXXXXX")"
    chown "$APP_SYSTEM_USER:$APP_SYSTEM_GROUP" "$temp_dir"

    if [ -d "$release_node_modules_path" ] && [ ! -L "$release_node_modules_path" ]; then
      install -o "$APP_SYSTEM_USER" -g "$APP_SYSTEM_GROUP" -m 0644 "$package_json_path" "${temp_dir}/package.json"
      install -o "$APP_SYSTEM_USER" -g "$APP_SYSTEM_GROUP" -m 0644 "$package_lock_path" "${temp_dir}/package-lock.json"
      mv "$release_node_modules_path" "${temp_dir}/node_modules"
      chown -R "$APP_SYSTEM_USER:$APP_SYSTEM_GROUP" "$temp_dir"
    else
      install_backend_dependency_cache "$package_json_path" "$package_lock_path" "$temp_dir"
    fi

    if [ -e "$cache_dir" ]; then
      rm -rf "$temp_dir"
    else
      mv "$temp_dir" "$cache_dir"
    fi
  fi

  if [ -e "$release_node_modules_path" ] && [ ! -L "$release_node_modules_path" ]; then
    rm -rf "$release_node_modules_path"
  fi

  ln -sfn "$cache_node_modules_path" "$release_node_modules_path"
}

prepare_runtime_tree() {
  local release_dir="$1"
  local backend_dir="${release_dir}/backend"
  local backend_dist_dir="${release_dir}/backend-dist"
  local frontend_dir="${release_dir}/frontend"
  local backend_data_dir="${backend_dir}/.data"
  local backend_uploads_link="${backend_data_dir}/uploads"

  require_dir "$backend_dir"
  require_dir "$frontend_dir"

  install -d -o "$APP_SYSTEM_USER" -g "$APP_SYSTEM_GROUP" "$SHARED_DIR" "$UPLOADS_DIR" "$SHARED_NODE_MODULES_DIR"
  install -d -m 0755 "$backend_data_dir"

  if [ -e "$backend_uploads_link" ] && [ ! -L "$backend_uploads_link" ]; then
    fail "Backend uploads runtime path must be a symlink: ${backend_uploads_link}"
  fi

  ln -sfn "$UPLOADS_DIR" "$backend_uploads_link"

  if [ -d "$backend_dist_dir" ] && [ ! -f "${backend_dir}/dist/src/server.js" ]; then
    mkdir -p "${backend_dir}/dist"
    rsync -a --delete "${backend_dist_dir}/" "${backend_dir}/dist/"
  fi

  if [ ! -f "${backend_dir}/dist/src/server.js" ]; then
    fail "Backend runtime entrypoint missing: ${backend_dir}/dist/src/server.js"
  fi

  ensure_backend_dependency_cache "$backend_dir"
}

wait_for_ready() {
  local attempt

  if ! command -v curl >/dev/null 2>&1; then
    return 0
  fi

  for attempt in $(seq 1 "$READY_RETRIES"); do
    if curl --fail --silent --show-error "$READY_URL" >/dev/null; then
      return 0
    fi
    sleep "$READY_DELAY_SECONDS"
  done

  fail "Readiness check failed: ${READY_URL}"
}
