#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SCRIPT_UNDER_TEST="${PROJECT_ROOT}/infra/scripts/postgres_backup.sh"

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

make_stub_environment() {
    local workdir="$1"

    mkdir -p "$workdir/bin" "$workdir/backups" "$workdir/etc"

    cat >"$workdir/bin/pg_dump" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

output_file=""
database_url=""

for arg in "$@"; do
    case "$arg" in
        --file=*)
            output_file="${arg#--file=}"
            ;;
        postgres://*)
            database_url="$arg"
            ;;
    esac
done

[ -n "$output_file" ] || exit 1
printf 'stub backup for %s\n' "$database_url" > "$output_file"
EOF

    cat >"$workdir/bin/sha256sum" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'deadbeef  %s\n' "$1"
EOF

    chmod +x "$workdir/bin/pg_dump" "$workdir/bin/sha256sum"

    cat >"$workdir/etc/backend.env" <<'EOF'
DATABASE_URL=postgres://backup_user:backup_pass@127.0.0.1:5432/novinzhstroy
EOF
}

run_case_creates_backup_and_prunes_old_files() {
    local workdir
    local old_dump
    local old_checksum

    workdir="$(mktemp -d)"
    trap 'rm -rf "$workdir"' RETURN

    make_stub_environment "$workdir"

    old_dump="${workdir}/backups/novinzhstroy_20250101T000000Z.dump"
    old_checksum="${old_dump}.sha256"
    printf 'old dump\n' > "$old_dump"
    printf 'old checksum\n' > "$old_checksum"
    touch -d '30 days ago' "$old_dump" "$old_checksum"

    PATH="$workdir/bin:$PATH" \
    PG_DUMP_BIN="$workdir/bin/pg_dump" \
    SHA256_BIN="$workdir/bin/sha256sum" \
    BACKEND_ENV_FILE="$workdir/etc/backend.env" \
    BACKUP_DIR="$workdir/backups" \
    RETENTION_DAYS=14 \
    TIMESTAMP=20260307T040000Z \
    bash "$SCRIPT_UNDER_TEST"

    assert_exists "${workdir}/backups/novinzhstroy_20260307T040000Z.dump"
    assert_exists "${workdir}/backups/novinzhstroy_20260307T040000Z.dump.sha256"
    assert_contains "${workdir}/backups/novinzhstroy_20260307T040000Z.dump" "stub backup for postgres://backup_user:backup_pass@127.0.0.1:5432/novinzhstroy"
    assert_contains "${workdir}/backups/novinzhstroy_20260307T040000Z.dump.sha256" "deadbeef"
    assert_not_exists "$old_dump"
    assert_not_exists "$old_checksum"
}

run_case_creates_backup_and_prunes_old_files

printf 'postgres_backup tests: OK\n'
