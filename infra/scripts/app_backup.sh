#!/usr/bin/env bash
set -Eeuo pipefail

TAR_BIN="${TAR_BIN:-$(command -v tar || true)}"
SHA256_BIN="${SHA256_BIN:-$(command -v sha256sum || true)}"
APP_ROOT="${APP_ROOT:-/srv/novinzhstroy}"
BACKUP_ROOT="${BACKUP_ROOT:-/srv/backups/novinzhstroy}"
NGINX_SITE_PATH="${NGINX_SITE_PATH:-/etc/nginx/sites-available/novinzhstroy.conf}"
BACKEND_SERVICE_PATH="${BACKEND_SERVICE_PATH:-/etc/systemd/system/novinzhstroy-backend.service}"
BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-/etc/novinzhstroy/backend.env}"
NGINX_SITE_ARCHIVE_PATH="${NGINX_SITE_ARCHIVE_PATH:-/etc/nginx/sites-available/novinzhstroy.conf}"
BACKEND_SERVICE_ARCHIVE_PATH="${BACKEND_SERVICE_ARCHIVE_PATH:-/etc/systemd/system/novinzhstroy-backend.service}"
BACKEND_ENV_ARCHIVE_PATH="${BACKEND_ENV_ARCHIVE_PATH:-/etc/novinzhstroy/backend.env}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
TIMESTAMP="${TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"

fail() {
    printf '%s\n' "$*" >&2
    exit 1
}

require_bin() {
    local bin_path="$1"
    local bin_name="$2"

    if [ -z "$bin_path" ] || [ ! -x "$bin_path" ]; then
        fail "${bin_name} is required"
    fi
}

require_file() {
    local path="$1"
    local description="$2"

    if [ ! -f "$path" ]; then
        fail "${description} not found: ${path}"
    fi
}

resolve_path() {
    local path="$1"
    local resolved_path=""

    if [ ! -e "$path" ]; then
        printf '\n'
        return 0
    fi

    resolved_path="$(readlink -f "$path" || true)"
    if [ -z "$resolved_path" ] || [ ! -e "$resolved_path" ]; then
        fail "Unable to resolve path: ${path}"
    fi

    printf '%s\n' "$resolved_path"
}

copy_file_into_stage() {
    local source_path="$1"
    local archive_path="$2"
    local stage_root="$3"
    local relative_path="${archive_path#/}"
    local destination_path="${stage_root}/${relative_path}"

    install -d -m 0700 "$(dirname "$destination_path")"
    install -m 0600 "$source_path" "$destination_path"
}

write_manifest() {
    local manifest_path="$1"
    local current_target="$2"
    local previous_target="$3"
    local current_release="${current_target##*/}"
    local previous_release="none"
    local previous_target_value="none"
    local shared_path="missing"
    local hostname_value

    if [ -n "$previous_target" ]; then
        previous_release="${previous_target##*/}"
        previous_target_value="$previous_target"
    fi

    if [ -d "${APP_ROOT}/shared" ]; then
        shared_path="${APP_ROOT}/shared"
    fi

    hostname_value="$(hostname 2>/dev/null || printf 'unknown')"

    cat >"$manifest_path" <<EOF
timestamp=${TIMESTAMP}
app_root=${APP_ROOT}
backup_root=${BACKUP_ROOT}
current_release=${current_release}
current_target=${current_target}
previous_release=${previous_release}
previous_target=${previous_target_value}
shared_path=${shared_path}
nginx_site_path=${NGINX_SITE_PATH}
backend_service_path=${BACKEND_SERVICE_PATH}
backend_env_file=${BACKEND_ENV_FILE}
retention_days=${RETENTION_DAYS}
hostname=${hostname_value}
EOF
}

purge_old_backups() {
    find "$BACKUP_ROOT" -maxdepth 1 -type f -name 'novinzhstroy_*.tar.gz' -mtime +"$RETENTION_DAYS" -delete
    find "$BACKUP_ROOT" -maxdepth 1 -type f -name 'novinzhstroy_*.tar.gz.sha256' -mtime +"$RETENTION_DAYS" -delete
    find "$BACKUP_ROOT" -maxdepth 1 -type f -name 'novinzhstroy_*.manifest' -mtime +"$RETENTION_DAYS" -delete
}

main() {
    local current_target=""
    local previous_target=""
    local archive_basename=""
    local stage_dir=""
    local archive_temp=""
    local archive_file=""
    local checksum_temp=""
    local checksum_file=""
    local manifest_temp=""
    local manifest_file=""

    require_bin "$TAR_BIN" "tar"
    require_bin "$SHA256_BIN" "sha256sum"

    case "$RETENTION_DAYS" in
        ''|*[!0-9]*)
            fail "RETENTION_DAYS must be a non-negative integer"
            ;;
    esac

    require_file "$NGINX_SITE_PATH" "Nginx site config"
    require_file "$BACKEND_SERVICE_PATH" "Backend systemd unit"
    require_file "$BACKEND_ENV_FILE" "Backend env file"

    current_target="$(resolve_path "${APP_ROOT}/current")"
    if [ -z "$current_target" ]; then
        fail "Current release not found: ${APP_ROOT}/current"
    fi

    previous_target="$(resolve_path "${APP_ROOT}/previous")"

    install -d -m 0700 "$BACKUP_ROOT"

    archive_basename="novinzhstroy_${TIMESTAMP}"
    stage_dir="$(mktemp -d "${BACKUP_ROOT}/.${archive_basename}.XXXXXX")"
    archive_temp="${BACKUP_ROOT}/.${archive_basename}.tar.gz.tmp"
    archive_file="${BACKUP_ROOT}/${archive_basename}.tar.gz"
    checksum_temp="${BACKUP_ROOT}/.${archive_basename}.tar.gz.sha256.tmp"
    checksum_file="${BACKUP_ROOT}/${archive_basename}.tar.gz.sha256"
    manifest_temp="${BACKUP_ROOT}/.${archive_basename}.manifest.tmp"
    manifest_file="${BACKUP_ROOT}/${archive_basename}.manifest"

    trap "rm -rf '$stage_dir' '$archive_temp' '$checksum_temp' '$manifest_temp'" EXIT

    install -d -m 0700 "${stage_dir}/srv/novinzhstroy"
    ln -s "$current_target" "${stage_dir}/srv/novinzhstroy/current"

    if [ -n "$previous_target" ]; then
        ln -s "$previous_target" "${stage_dir}/srv/novinzhstroy/previous"
    fi

    if [ -d "${APP_ROOT}/shared" ]; then
        ln -s "${APP_ROOT}/shared" "${stage_dir}/srv/novinzhstroy/shared"
    fi

    copy_file_into_stage "$NGINX_SITE_PATH" "$NGINX_SITE_ARCHIVE_PATH" "$stage_dir"
    copy_file_into_stage "$BACKEND_SERVICE_PATH" "$BACKEND_SERVICE_ARCHIVE_PATH" "$stage_dir"
    copy_file_into_stage "$BACKEND_ENV_FILE" "$BACKEND_ENV_ARCHIVE_PATH" "$stage_dir"
    write_manifest "${stage_dir}/manifest.txt" "$current_target" "$previous_target"

    install -m 0600 "${stage_dir}/manifest.txt" "$manifest_temp"
    "$TAR_BIN" -C "$stage_dir" -chzf "$archive_temp" .

    mv "$archive_temp" "$archive_file"
    "$SHA256_BIN" "$archive_file" > "$checksum_temp"
    mv "$manifest_temp" "$manifest_file"
    mv "$checksum_temp" "$checksum_file"

    purge_old_backups

    printf 'Application backup created: %s\n' "$archive_file"
}

main "$@"
