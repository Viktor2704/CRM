#!/usr/bin/env bash
set -Eeuo pipefail

PG_RESTORE_BIN="${PG_RESTORE_BIN:-$(command -v pg_restore || true)}"
PSQL_BIN="${PSQL_BIN:-$(command -v psql || true)}"
SHA256_BIN="${SHA256_BIN:-$(command -v sha256sum || true)}"
RUNUSER_BIN="${RUNUSER_BIN:-$(command -v runuser || true)}"
INSTALL_BIN="${INSTALL_BIN:-$(command -v install || true)}"
BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-/etc/novinzhstroy/backend.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/postgres}"
VERIFY_DB="${VERIFY_DB:-novinzhstroy_restore_verify}"
PGMAINTENANCE_DB="${PGMAINTENANCE_DB:-postgres}"
PG_SYSTEM_USER="${PG_SYSTEM_USER-postgres}"
PGHOST="${PGHOST:-/var/run/postgresql}"
PGPORT="${PGPORT:-5432}"

maintenance_url=""
verify_url=""
restore_input_file=""

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

build_connection_url() {
    local target_database="$1"
    local url_without_query="${DATABASE_URL%%\?*}"
    local query_suffix=""
    local url_prefix="${url_without_query%/*}"

    if [ "$url_prefix" = "$url_without_query" ] || [ -z "$url_prefix" ]; then
        fail "Unable to derive connection prefix from DATABASE_URL"
    fi

    if [ "$url_without_query" != "$DATABASE_URL" ]; then
        query_suffix="?${DATABASE_URL#*\?}"
    fi

    printf '%s/%s%s\n' "$url_prefix" "$target_database" "$query_suffix"
}

find_latest_backup() {
    local database_name="$1"
    local candidates=()
    local nullglob_was_set=0

    if shopt -q nullglob; then
        nullglob_was_set=1
    fi

    shopt -s nullglob
    candidates=("$BACKUP_DIR"/"${database_name}"_*.dump)

    if [ "$nullglob_was_set" -eq 0 ]; then
        shopt -u nullglob
    fi

    if [ "${#candidates[@]}" -eq 0 ]; then
        fail "No backups found in ${BACKUP_DIR} for ${database_name}"
    fi

    printf '%s\n' "${candidates[@]}" | LC_ALL=C sort | tail -n 1
}

cleanup_verify_db() {
    if [ -z "$maintenance_url" ] && [ -z "$PG_SYSTEM_USER" ]; then
        return
    fi

    psql_target_db "$PGMAINTENANCE_DB" \
        -v ON_ERROR_STOP=1 \
        -c "DROP DATABASE IF EXISTS \"$VERIFY_DB\" WITH (FORCE);" \
        >/dev/null 2>&1 || true
}

cleanup_restore_input_file() {
    if [ -n "$restore_input_file" ]; then
        rm -f "$restore_input_file"
    fi
}

cleanup_restore_verify() {
    cleanup_verify_db
    cleanup_restore_input_file
}

run_as_pg_system_user() {
    if [ -z "$PG_SYSTEM_USER" ]; then
        "$@"
        return
    fi

    if [ "$(id -un)" = "$PG_SYSTEM_USER" ]; then
        "$@"
        return
    fi

    require_bin "$RUNUSER_BIN" "runuser"
    "$RUNUSER_BIN" -u "$PG_SYSTEM_USER" -- "$@"
}

psql_target_db() {
    local database_name="$1"
    shift

    if [ -n "$PG_SYSTEM_USER" ]; then
        run_as_pg_system_user \
            "$PSQL_BIN" \
            --host="$PGHOST" \
            --port="$PGPORT" \
            --dbname="$database_name" \
            "$@"
        return
    fi

    "$PSQL_BIN" "$(build_connection_url "$database_name")" "$@"
}

pg_restore_target_db() {
    local database_name="$1"
    shift

    if [ -n "$PG_SYSTEM_USER" ]; then
        run_as_pg_system_user \
            "$PG_RESTORE_BIN" \
            --host="$PGHOST" \
            --port="$PGPORT" \
            --dbname="$database_name" \
            "$@"
        return
    fi

    "$PG_RESTORE_BIN" --dbname="$(build_connection_url "$database_name")" "$@"
}

prepare_restore_input() {
    local backup_file="$1"

    if [ -z "$PG_SYSTEM_USER" ]; then
        printf '%s\n' "$backup_file"
        return
    fi

    require_bin "$INSTALL_BIN" "install"
    restore_input_file="$(mktemp "${TMPDIR:-/tmp}/postgres-restore-verify.XXXXXX.dump")"
    "$INSTALL_BIN" -o "$PG_SYSTEM_USER" -g "$PG_SYSTEM_USER" -m 0640 "$backup_file" "$restore_input_file"
    printf '%s\n' "$restore_input_file"
}

restore_and_verify() {
    local backup_file="$1"
    local restore_source_file
    local restored_table_count

    restore_source_file="$(prepare_restore_input "$backup_file")"
    trap cleanup_restore_verify EXIT

    psql_target_db "$PGMAINTENANCE_DB" \
        -v ON_ERROR_STOP=1 \
        -c "DROP DATABASE IF EXISTS \"$VERIFY_DB\" WITH (FORCE);"

    psql_target_db "$PGMAINTENANCE_DB" \
        -v ON_ERROR_STOP=1 \
        -c "CREATE DATABASE \"$VERIFY_DB\" TEMPLATE template0;"

    pg_restore_target_db "$VERIFY_DB" \
        --clean \
        --if-exists \
        --no-owner \
        --no-privileges \
        "$restore_source_file"

    restored_table_count="$(
        psql_target_db "$VERIFY_DB" \
            -t -A \
            -v ON_ERROR_STOP=1 \
            -c "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema');"
    )"

    case "$restored_table_count" in
        ''|*[!0-9]*)
            fail "Restore verification failed: unexpected table count '${restored_table_count}'"
            ;;
    esac

    if [ "$restored_table_count" -le 0 ]; then
        fail "Restore verification failed: no user tables restored"
    fi

    printf 'Restore verification passed: %s (%s tables restored)\n' "$backup_file" "$restored_table_count"
}

main() {
    local database_name
    local backup_file
    local checksum_file

    if [ "$#" -gt 1 ]; then
        fail "Usage: $0 [/path/to/backup.dump]"
    fi

    require_bin "$PG_RESTORE_BIN" "pg_restore"
    require_bin "$PSQL_BIN" "psql"
    require_bin "$SHA256_BIN" "sha256sum"
    load_backend_env

    database_name="$(database_name_from_url)"
    if [ -z "$PG_SYSTEM_USER" ]; then
        maintenance_url="$(build_connection_url "$PGMAINTENANCE_DB")"
        verify_url="$(build_connection_url "$VERIFY_DB")"
    fi

    if [ "$#" -eq 1 ]; then
        backup_file="$1"
    else
        backup_file="$(find_latest_backup "$database_name")"
    fi

    if [ ! -f "$backup_file" ]; then
        fail "Backup file not found: ${backup_file}"
    fi

    checksum_file="${backup_file}.sha256"
    if [ ! -f "$checksum_file" ]; then
        fail "Checksum file not found: ${checksum_file}"
    fi

    "$SHA256_BIN" --check "$checksum_file"
    restore_and_verify "$backup_file"
}

main "$@"
