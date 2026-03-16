#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SCRIPT_UNDER_TEST="${PROJECT_ROOT}/infra/scripts/app_backup.sh"

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

assert_tar_contains() {
    local path="$1"
    local pattern="$2"

    tar -tzf "$path" | grep -Fq -- "$pattern" || fail "expected '${pattern}' in archive ${path}"
}

make_stub_environment() {
    local workdir="$1"

    mkdir -p \
        "$workdir/app/releases/release-current" \
        "$workdir/app/releases/release-previous" \
        "$workdir/app/shared/uploads" \
        "$workdir/etc/nginx/sites-available" \
        "$workdir/etc/systemd/system" \
        "$workdir/etc/novinzhstroy"

    printf 'current release\n' > "$workdir/app/releases/release-current/release.txt"
    printf 'previous release\n' > "$workdir/app/releases/release-previous/release.txt"
    printf 'uploaded file\n' > "$workdir/app/shared/uploads/example.txt"
    printf 'nginx config\n' > "$workdir/etc/nginx/sites-available/novinzhstroy.conf"
    printf '[Service]\nExecStart=/usr/bin/node\n' > "$workdir/etc/systemd/system/novinzhstroy-backend.service"
    printf 'DATABASE_URL=postgres://user:pass@127.0.0.1:5432/novinzhstroy\n' > "$workdir/etc/novinzhstroy/backend.env"

    ln -s "$workdir/app/releases/release-current" "$workdir/app/current"
    ln -s "$workdir/app/releases/release-previous" "$workdir/app/previous"
}

run_case_creates_archive_and_prunes_old_files() {
    local workdir
    local old_archive
    local old_manifest
    local old_checksum
    local backup_file

    workdir="$(mktemp -d)"
    trap 'rm -rf "$workdir"' RETURN

    make_stub_environment "$workdir"
    mkdir -p "$workdir/backups"

    old_archive="${workdir}/backups/novinzhstroy_20250201T000000Z.tar.gz"
    old_manifest="${workdir}/backups/novinzhstroy_20250201T000000Z.manifest"
    old_checksum="${old_archive}.sha256"
    printf 'old archive\n' > "$old_archive"
    printf 'old manifest\n' > "$old_manifest"
    printf 'old checksum\n' > "$old_checksum"
    touch -d '30 days ago' "$old_archive" "$old_manifest" "$old_checksum"

    APP_ROOT="$workdir/app" \
    BACKUP_ROOT="$workdir/backups" \
    NGINX_SITE_PATH="$workdir/etc/nginx/sites-available/novinzhstroy.conf" \
    BACKEND_SERVICE_PATH="$workdir/etc/systemd/system/novinzhstroy-backend.service" \
    BACKEND_ENV_FILE="$workdir/etc/novinzhstroy/backend.env" \
    RETENTION_DAYS=7 \
    TIMESTAMP=20260307T050000Z \
    bash "$SCRIPT_UNDER_TEST"

    backup_file="${workdir}/backups/novinzhstroy_20260307T050000Z.tar.gz"

    assert_exists "$backup_file"
    assert_exists "${backup_file}.sha256"
    assert_exists "${workdir}/backups/novinzhstroy_20260307T050000Z.manifest"
    assert_contains "${workdir}/backups/novinzhstroy_20260307T050000Z.manifest" "current_release=release-current"
    assert_contains "${workdir}/backups/novinzhstroy_20260307T050000Z.manifest" "previous_release=release-previous"
    assert_contains "${backup_file}.sha256" "novinzhstroy_20260307T050000Z.tar.gz"
    assert_tar_contains "$backup_file" "./manifest.txt"
    assert_tar_contains "$backup_file" "./srv/novinzhstroy/current/release.txt"
    assert_tar_contains "$backup_file" "./srv/novinzhstroy/previous/release.txt"
    assert_tar_contains "$backup_file" "./srv/novinzhstroy/shared/uploads/example.txt"
    assert_tar_contains "$backup_file" "./etc/nginx/sites-available/novinzhstroy.conf"
    assert_tar_contains "$backup_file" "./etc/systemd/system/novinzhstroy-backend.service"
    assert_tar_contains "$backup_file" "./etc/novinzhstroy/backend.env"
    assert_not_exists "$old_archive"
    assert_not_exists "$old_manifest"
    assert_not_exists "$old_checksum"
}

run_case_creates_archive_and_prunes_old_files

printf 'app_backup tests: OK\n'
