#!/usr/bin/env bash
set -Eeuo pipefail

PSQL_BIN="${PSQL_BIN:-$(command -v psql || true)}"
RUNUSER_BIN="${RUNUSER_BIN:-$(command -v runuser || true)}"
INSTALL_BIN="${INSTALL_BIN:-$(command -v install || true)}"
LN_BIN="${LN_BIN:-$(command -v ln || true)}"
BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-/etc/novinzhstroy/backend.env}"
OUTPUT_DIR="${OUTPUT_DIR:-/var/log/novinzhstroy/postgres-top-sql}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
TOP_LIMIT="${TOP_LIMIT:-20}"
TIMESTAMP="${TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
PG_SYSTEM_USER="${PG_SYSTEM_USER-postgres}"
PGHOST="${PGHOST:-/var/run/postgresql}"
PGPORT="${PGPORT:-5432}"

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

require_non_negative_integer() {
    local value="$1"
    local label="$2"

    case "$value" in
        ''|*[!0-9]*)
            fail "${label} must be a non-negative integer"
            ;;
    esac
}

require_positive_integer() {
    local value="$1"
    local label="$2"

    require_non_negative_integer "$value" "$label"
    if [ "$value" -le 0 ]; then
        fail "${label} must be greater than zero"
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

ensure_pg_stat_statements_enabled() {
    local database_name="$1"
    local extension_enabled

    extension_enabled="$(
        psql_target_db "$database_name" \
            -t -A \
            -v ON_ERROR_STOP=1 \
            -c "SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements';"
    )"

    if [ "$extension_enabled" != "1" ]; then
        fail "pg_stat_statements extension is not enabled in database ${database_name}"
    fi
}

write_snapshot() {
    local database_name="$1"
    local temp_file="${OUTPUT_DIR}/.${database_name}_${TIMESTAMP}.csv.tmp"
    local snapshot_file="${OUTPUT_DIR}/${database_name}_${TIMESTAMP}.csv"
    local latest_link="${OUTPUT_DIR}/latest.csv"
    local sql

    read -r -d '' sql <<SQL || true
COPY (
    WITH ranked AS (
        SELECT
            row_number() OVER (
                ORDER BY total_exec_time DESC NULLS LAST, calls DESC, queryid::text ASC
            ) AS rank,
            coalesce(queryid::text, '') AS queryid,
            calls,
            round(total_exec_time::numeric, 3) AS total_exec_time_ms,
            round(mean_exec_time::numeric, 3) AS mean_exec_time_ms,
            rows,
            shared_blks_hit,
            shared_blks_read,
            coalesce(
                round(
                    100 * shared_blks_hit::numeric / nullif(shared_blks_hit + shared_blks_read, 0),
                    2
                ),
                0
            ) AS hit_percent,
            left(regexp_replace(query, E'[[:space:]]+', ' ', 'g'), 2000) AS query
        FROM pg_stat_statements
        WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND coalesce(query, '') <> ''
          AND query NOT ILIKE 'BEGIN%'
          AND query NOT ILIKE 'COMMIT%'
          AND query NOT ILIKE 'ROLLBACK%'
          AND query NOT ILIKE 'SET %'
          AND query NOT ILIKE 'SHOW %'
          AND query NOT ILIKE 'START TRANSACTION%'
          AND query NOT ILIKE '%pg_stat_statements%'
    )
    SELECT
        rank,
        queryid,
        calls,
        total_exec_time_ms,
        mean_exec_time_ms,
        rows,
        shared_blks_hit,
        shared_blks_read,
        hit_percent,
        query
    FROM ranked
    ORDER BY rank
    LIMIT ${TOP_LIMIT}
) TO STDOUT WITH (FORMAT csv, HEADER true)
SQL

    psql_target_db "$database_name" \
        -X \
        -v ON_ERROR_STOP=1 \
        -c "$sql" \
        > "$temp_file"

    mv "$temp_file" "$snapshot_file"
    "$LN_BIN" -sfn "$(basename "$snapshot_file")" "$latest_link"

    printf '%s\n' "$snapshot_file"
}

purge_old_snapshots() {
    local database_name="$1"

    find "$OUTPUT_DIR" -maxdepth 1 -type f -name "${database_name}_*.csv" -mtime +"$RETENTION_DAYS" -delete
}

main() {
    local database_name
    local snapshot_file

    require_bin "$PSQL_BIN" "psql"
    require_bin "$INSTALL_BIN" "install"
    require_bin "$LN_BIN" "ln"
    require_non_negative_integer "$RETENTION_DAYS" "RETENTION_DAYS"
    require_positive_integer "$TOP_LIMIT" "TOP_LIMIT"
    load_backend_env

    database_name="$(database_name_from_url)"
    "$INSTALL_BIN" -d -m 0750 "$OUTPUT_DIR"
    ensure_pg_stat_statements_enabled "$database_name"
    snapshot_file="$(write_snapshot "$database_name")"
    purge_old_snapshots "$database_name"

    printf 'Top SQL snapshot created: %s\n' "$snapshot_file"
}

main "$@"
