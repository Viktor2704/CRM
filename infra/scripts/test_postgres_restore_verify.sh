#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SCRIPT_UNDER_TEST="${PROJECT_ROOT}/infra/scripts/postgres_restore_verify.sh"

fail() {
    printf 'FAIL: %s\n' "$*" >&2
    exit 1
}

assert_contains() {
    local path="$1"
    local pattern="$2"

    grep -Fq -- "$pattern" "$path" || fail "expected '${pattern}' in ${path}"
}

make_stub_environment() {
    local workdir="$1"

    mkdir -p "$workdir/bin" "$workdir/backups" "$workdir/etc"

    cat >"$workdir/bin/sha256sum" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'sha256sum %s\n' "$*" >> "${STUB_LOG:?}"
if [ "${1:-}" = "--check" ] && [ -n "${2:-}" ]; then
    exit 0
fi
exit 1
EOF

    cat >"$workdir/bin/psql" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'psql %s\n' "$*" >> "${STUB_LOG:?}"
case "$*" in
    *"SELECT count(*) FROM pg_catalog.pg_tables"*)
        printf '12\n'
        ;;
esac
EOF

    cat >"$workdir/bin/pg_restore" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'pg_restore %s\n' "$*" >> "${STUB_LOG:?}"
EOF

    chmod +x "$workdir/bin/sha256sum" "$workdir/bin/psql" "$workdir/bin/pg_restore"

    cat >"$workdir/etc/backend.env" <<'EOF'
DATABASE_URL=postgres://restore_user:restore_pass@127.0.0.1:5432/novinzhstroy?sslmode=disable
EOF
}

run_case_restores_explicit_backup() {
    local workdir
    local log_file
    local backup_file

    workdir="$(mktemp -d)"
    trap 'rm -rf "$workdir"' RETURN

    make_stub_environment "$workdir"
    log_file="${workdir}/stub.log"
    backup_file="${workdir}/backups/novinzhstroy_20260307T040000Z.dump"
    printf 'stub backup\n' > "$backup_file"
    printf 'checksum\n' > "${backup_file}.sha256"

    PATH="$workdir/bin:$PATH" \
    STUB_LOG="$log_file" \
    PG_RESTORE_BIN="$workdir/bin/pg_restore" \
    PSQL_BIN="$workdir/bin/psql" \
    SHA256_BIN="$workdir/bin/sha256sum" \
    BACKEND_ENV_FILE="$workdir/etc/backend.env" \
    BACKUP_DIR="$workdir/backups" \
    VERIFY_DB=novinzhstroy_restore_verify \
    PGMAINTENANCE_DB=postgres \
    PG_SYSTEM_USER= \
    bash "$SCRIPT_UNDER_TEST" "$backup_file"

    assert_contains "$log_file" "sha256sum --check ${backup_file}.sha256"
    assert_contains "$log_file" "psql postgres://restore_user:restore_pass@127.0.0.1:5432/postgres?sslmode=disable -v ON_ERROR_STOP=1 -c DROP DATABASE IF EXISTS \"novinzhstroy_restore_verify\" WITH (FORCE);"
    assert_contains "$log_file" "psql postgres://restore_user:restore_pass@127.0.0.1:5432/postgres?sslmode=disable -v ON_ERROR_STOP=1 -c CREATE DATABASE \"novinzhstroy_restore_verify\" TEMPLATE template0;"
    assert_contains "$log_file" "pg_restore --dbname=postgres://restore_user:restore_pass@127.0.0.1:5432/novinzhstroy_restore_verify?sslmode=disable --clean --if-exists --no-owner --no-privileges ${backup_file}"
    assert_contains "$log_file" "psql postgres://restore_user:restore_pass@127.0.0.1:5432/novinzhstroy_restore_verify?sslmode=disable -t -A -v ON_ERROR_STOP=1 -c SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema');"
}

run_case_uses_latest_backup_by_default() {
    local workdir
    local log_file
    local old_backup
    local latest_backup

    workdir="$(mktemp -d)"
    trap 'rm -rf "$workdir"' RETURN

    make_stub_environment "$workdir"
    log_file="${workdir}/stub.log"
    old_backup="${workdir}/backups/novinzhstroy_20260306T040000Z.dump"
    latest_backup="${workdir}/backups/novinzhstroy_20260307T040000Z.dump"
    printf 'old backup\n' > "$old_backup"
    printf 'old checksum\n' > "${old_backup}.sha256"
    printf 'latest backup\n' > "$latest_backup"
    printf 'latest checksum\n' > "${latest_backup}.sha256"

    PATH="$workdir/bin:$PATH" \
    STUB_LOG="$log_file" \
    PG_RESTORE_BIN="$workdir/bin/pg_restore" \
    PSQL_BIN="$workdir/bin/psql" \
    SHA256_BIN="$workdir/bin/sha256sum" \
    BACKEND_ENV_FILE="$workdir/etc/backend.env" \
    BACKUP_DIR="$workdir/backups" \
    PG_SYSTEM_USER= \
    bash "$SCRIPT_UNDER_TEST"

    assert_contains "$log_file" "pg_restore --dbname=postgres://restore_user:restore_pass@127.0.0.1:5432/novinzhstroy_restore_verify?sslmode=disable --clean --if-exists --no-owner --no-privileges ${latest_backup}"
}

run_case_restores_explicit_backup
run_case_uses_latest_backup_by_default

printf 'postgres_restore_verify tests: OK\n'
