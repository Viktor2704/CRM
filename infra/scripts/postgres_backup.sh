#!/usr/bin/env bash
set -Eeuo pipefail

PG_DUMP_BIN="${PG_DUMP_BIN:-$(command -v pg_dump || true)}"
SHA256_BIN="${SHA256_BIN:-$(command -v sha256sum || true)}"
BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-/etc/novinzhstroy/backend.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
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

load_backend_env() {
    if [ ! -f "$BACKEND_ENV_FILE" ]; then
        fail "Backend env file not found: ${BACKEND_ENV_FILE}"
    fi

    set -a
    # shellcheck disable=SC1090
    . "$BACKEND_ENV_FILE"
    set +a

    : "${DATABASE_URL:?DATABASE_URL is required in ${BACKEND_ENV_FILE}}"
}

database_name_from_url() {
    local url_without_query="${DATABASE_URL%%\?*}"
    local database_name="${url_without_query##*/}"

    if [ -z "$database_name" ] || [ "$database_name" = "$url_without_query" ]; then
        fail "Unable to derive database name from DATABASE_URL"
    fi

    printf '%s\n' "$database_name"
}

create_backup() {
    local database_name="$1"
    local temp_file="${BACKUP_DIR}/.${database_name}_${TIMESTAMP}.dump.tmp"
    local backup_file="${BACKUP_DIR}/${database_name}_${TIMESTAMP}.dump"

    install -d -m 0700 "$BACKUP_DIR"
    trap "rm -f '$temp_file'" EXIT

    "$PG_DUMP_BIN" \
        --format=custom \
        --no-owner \
        --no-privileges \
        --clean \
        --if-exists \
        --file="$temp_file" \
        "$DATABASE_URL"

    mv "$temp_file" "$backup_file"
    "$SHA256_BIN" "$backup_file" > "${backup_file}.sha256"

    printf '%s\n' "$backup_file"
}

purge_old_backups() {
    local database_name="$1"

    find "$BACKUP_DIR" -maxdepth 1 -type f -name "${database_name}_*.dump" -mtime +"$RETENTION_DAYS" -delete
    find "$BACKUP_DIR" -maxdepth 1 -type f -name "${database_name}_*.dump.sha256" -mtime +"$RETENTION_DAYS" -delete
}

main() {
    local database_name
    local backup_file

    require_bin "$PG_DUMP_BIN" "pg_dump"
    require_bin "$SHA256_BIN" "sha256sum"
    load_backend_env

    database_name="$(database_name_from_url)"
    backup_file="$(create_backup "$database_name")"
    purge_old_backups "$database_name"

    printf 'Backup created: %s\n' "$backup_file"
}

main "$@"
