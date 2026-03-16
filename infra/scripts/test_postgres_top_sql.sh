#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SCRIPT_UNDER_TEST="${PROJECT_ROOT}/infra/scripts/postgres_top_sql.sh"

fail() {
    printf 'FAIL: %s\n' "$*" >&2
    exit 1
}

assert_exists() {
    local path="$1"
    [ -e "$path" ] || fail "expected ${path} to exist"
}

assert_not_exists() {
    local path="$1"
    [ ! -e "$path" ] || fail "expected ${path} to be removed"
}

assert_contains() {
    local path="$1"
    local pattern="$2"
    grep -Fq -- "$pattern" "$path" || fail "expected '${pattern}' in ${path}"
}

assert_symlink_target() {
    local path="$1"
    local expected_target="$2"
    local actual_target

    actual_target="$(readlink "$path")"
    [ "$actual_target" = "$expected_target" ] || fail "expected ${path} -> ${expected_target}, got ${actual_target}"
}

make_stub_environment() {
    local workdir="$1"

    mkdir -p "$workdir/bin" "$workdir/output" "$workdir/etc"

    cat >"$workdir/bin/psql" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'psql %s\n' "$*" >> "${STUB_LOG:?}"
case "$*" in
    *"SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements';"*)
        printf '1\n'
        ;;
    *"COPY ("*)
        cat <<'CSV'
rank,queryid,calls,total_exec_time_ms,mean_exec_time_ms,rows,shared_blks_hit,shared_blks_read,hit_percent,query
1,12345,18,812.334,45.130,42,90,3,96.77,"select * from requests where id = $1"
2,67890,9,101.200,11.244,9,30,5,85.71,"update requests set status = $1 where id = $2"
CSV
        ;;
    *)
        printf 'unexpected psql invocation: %s\n' "$*" >&2
        exit 1
        ;;
esac
EOF

    cat >"$workdir/bin/runuser" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'runuser %s\n' "$*" >> "${STUB_LOG:?}"
if [ "${1:-}" = "-u" ]; then
    shift 2
fi
if [ "${1:-}" = "--" ]; then
    shift
fi
"$@"
EOF

    chmod +x "$workdir/bin/psql" "$workdir/bin/runuser"

    cat >"$workdir/etc/backend.env" <<'EOF'
DATABASE_URL=postgres://collector_user:collector_pass@127.0.0.1:5432/novinzhstroy
EOF
}

run_case_creates_snapshot_and_prunes_old_files() {
    local workdir
    local log_file
    local old_snapshot
    local new_snapshot

    workdir="$(mktemp -d)"
    trap 'rm -rf "$workdir"' RETURN

    make_stub_environment "$workdir"
    log_file="${workdir}/stub.log"
    old_snapshot="${workdir}/output/novinzhstroy_20250101T000000Z.csv"
    printf 'old snapshot\n' > "$old_snapshot"
    touch -d '30 days ago' "$old_snapshot"

    PATH="$workdir/bin:$PATH" \
    STUB_LOG="$log_file" \
    PSQL_BIN="$workdir/bin/psql" \
    RUNUSER_BIN="$workdir/bin/runuser" \
    BACKEND_ENV_FILE="$workdir/etc/backend.env" \
    OUTPUT_DIR="$workdir/output" \
    RETENTION_DAYS=7 \
    TOP_LIMIT=20 \
    TIMESTAMP=20260307T073500Z \
    PG_SYSTEM_USER=postgres \
    PGHOST=/var/run/postgresql \
    PGPORT=5432 \
    bash "$SCRIPT_UNDER_TEST"

    new_snapshot="${workdir}/output/novinzhstroy_20260307T073500Z.csv"

    assert_exists "$new_snapshot"
    assert_exists "${workdir}/output/latest.csv"
    assert_symlink_target "${workdir}/output/latest.csv" "novinzhstroy_20260307T073500Z.csv"
    assert_contains "$new_snapshot" 'rank,queryid,calls,total_exec_time_ms,mean_exec_time_ms,rows,shared_blks_hit,shared_blks_read,hit_percent,query'
    assert_contains "$new_snapshot" 'select * from requests where id = $1'
    assert_contains "$log_file" 'runuser -u postgres --'
    assert_contains "$log_file" '--dbname=novinzhstroy'
    assert_not_exists "$old_snapshot"
}

run_case_creates_snapshot_and_prunes_old_files

printf 'postgres_top_sql tests: OK\n'
