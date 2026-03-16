#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
DEPLOY_SCRIPT="${PROJECT_ROOT}/infra/scripts/deploy_release.sh"
ROLLBACK_SCRIPT="${PROJECT_ROOT}/infra/scripts/rollback_release.sh"

fail() {
    printf 'FAIL: %s\n' "$*" >&2
    exit 1
}

assert_exists() {
    local path="$1"
    [ -e "$path" ] || fail "expected ${path} to exist"
}

assert_symlink_target() {
    local path="$1"
    local expected_target="$2"
    local actual_target

    [ -L "$path" ] || fail "expected ${path} to be a symlink"
    actual_target="$(readlink -f "$path")"
    [ "$actual_target" = "$expected_target" ] || fail "expected ${path} -> ${expected_target}, got ${actual_target}"
}

assert_contains() {
    local path="$1"
    local pattern="$2"
    grep -Fq -- "$pattern" "$path" || fail "expected '${pattern}' in ${path}"
}

assert_not_exists() {
    local path="$1"
    [ ! -e "$path" ] || fail "expected ${path} to be absent"
}

assert_line_count() {
    local path="$1"
    local pattern="$2"
    local expected_count="$3"
    local actual_count

    actual_count="$(grep -Ec -- "$pattern" "$path")"
    [ "$actual_count" = "$expected_count" ] || fail "expected ${expected_count} matches for ${pattern} in ${path}, got ${actual_count}"
}

install_stub_commands() {
    local workdir="$1"
    local bin_dir="${workdir}/bin"
    local stub_log="${workdir}/stub.log"

    mkdir -p "$bin_dir"
    : > "$stub_log"

    cat > "${bin_dir}/npm" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'npm %s\n' "$*" >> "$STUB_LOG"
prefix_dir=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --prefix)
            prefix_dir="${2:-}"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done
if [ -n "$prefix_dir" ]; then
    mkdir -p "${prefix_dir}/node_modules"
fi
exit 0
EOF

    cat > "${bin_dir}/systemctl" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'systemctl %s\n' "$*" >> "$STUB_LOG"
case "${1:-}" in
    restart|is-active)
        exit 0
        ;;
    *)
        printf 'unexpected systemctl args: %s\n' "$*" >&2
        exit 1
        ;;
esac
EOF

    cat > "${bin_dir}/curl" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'curl %s\n' "$*" >> "$STUB_LOG"
exit 0
EOF

    cat > "${bin_dir}/runuser" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'runuser %s\n' "$*" >> "$STUB_LOG"
if [ "${1:-}" != "-u" ] || [ "$#" -lt 4 ] || [ "${3:-}" != "--" ]; then
    printf 'unexpected runuser args: %s\n' "$*" >&2
    exit 1
fi
shift 3
"$@"
EOF

    cat > "${bin_dir}/rsync" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
if [ "$#" -lt 2 ]; then
    printf 'unsupported rsync args: %s\n' "$*" >&2
    exit 1
fi
src="${@: -2:1}"
dest="${@: -1}"
rm -rf "$dest"
mkdir -p "$dest"
cp -a "${src%/}/." "$dest/"
EOF

    chmod +x "${bin_dir}/npm" "${bin_dir}/systemctl" "${bin_dir}/curl" "${bin_dir}/runuser" "${bin_dir}/rsync"

    printf '%s\n' "$stub_log"
}

make_release_tree() {
    local release_dir="$1"

    mkdir -p \
        "${release_dir}/backend/dist/src" \
        "${release_dir}/frontend" \
        "${release_dir}/frontend-dist" \
        "${release_dir}/infra"

    printf 'console.log("server");\n' > "${release_dir}/backend/dist/src/server.js"
    printf '{\"name\":\"backend\"}\n' > "${release_dir}/backend/package.json"
    printf '{\"lockfileVersion\":3}\n' > "${release_dir}/backend/package-lock.json"
    printf '{\"name\":\"frontend\"}\n' > "${release_dir}/frontend/package.json"
    printf '{\"lockfileVersion\":3}\n' > "${release_dir}/frontend/package-lock.json"
    printf 'release=%s\n' "${release_dir##*/}" > "${release_dir}/release.txt"
}

make_bundle_tree() {
    local bundle_dir="$1"
    local release_stub_dir="${bundle_dir}/release-input"

    make_release_tree "$release_stub_dir"

    mkdir -p "$bundle_dir"
    mv "${release_stub_dir}/backend" "$bundle_dir/backend"
    mv "${release_stub_dir}/frontend" "$bundle_dir/frontend"
    mv "${release_stub_dir}/frontend-dist" "$bundle_dir/frontend-dist"
    mv "${release_stub_dir}/infra" "$bundle_dir/infra"
    rm -rf "$release_stub_dir"
}

run_case_deploy_creates_runtime_upload_symlink() {
    local workdir
    local old_release
    local bundle_dir
    local stub_log
    local dependency_hash

    workdir="$(mktemp -d)"
    trap 'rm -rf "$workdir"' RETURN

    old_release="${workdir}/app/releases/release-old"
    bundle_dir="${workdir}/bundle"

    mkdir -p "${workdir}/app/releases"
    make_release_tree "$old_release"
    make_bundle_tree "$bundle_dir"
    ln -s "$old_release" "${workdir}/app/current"
    dependency_hash="$(sha256sum "${bundle_dir}/backend/package-lock.json" | cut -d ' ' -f 1)"

    stub_log="$(install_stub_commands "$workdir")"

    PATH="${workdir}/bin:${PATH}" \
    STUB_LOG="$stub_log" \
    APP_ROOT="${workdir}/app" \
    BACKEND_SERVICE_NAME="stub-backend.service" \
    READY_RETRIES=1 \
    RELEASE_ID="release-new" \
    bash "$DEPLOY_SCRIPT" "$bundle_dir"

    assert_exists "${workdir}/app/shared/uploads"
    assert_exists "${workdir}/app/shared/node_modules/backend-${dependency_hash}/node_modules"
    assert_symlink_target "${workdir}/app/current" "${workdir}/app/releases/release-new"
    assert_symlink_target "${workdir}/app/previous" "$old_release"
    assert_symlink_target "${workdir}/app/releases/release-new/backend/.data/uploads" "${workdir}/app/shared/uploads"
    assert_symlink_target "${workdir}/app/releases/release-new/backend/node_modules" "${workdir}/app/shared/node_modules/backend-${dependency_hash}/node_modules"
    assert_not_exists "${workdir}/app/releases/release-new/frontend/node_modules"
    assert_contains "$stub_log" "runuser -u novin -- env HOME="
    assert_contains "$stub_log" "npm ci --omit=dev --prefix "
    assert_line_count "$stub_log" '^npm ' 1
    assert_contains "$stub_log" "systemctl restart stub-backend.service"
    assert_contains "$stub_log" "curl --fail --silent --show-error http://127.0.0.1:8080/ready"
}

run_case_rollback_creates_runtime_upload_symlink() {
    local workdir
    local target_release
    local current_release
    local stub_log
    local dependency_hash

    workdir="$(mktemp -d)"
    trap 'rm -rf "$workdir"' RETURN

    target_release="${workdir}/app/releases/release-target"
    current_release="${workdir}/app/releases/release-current"

    mkdir -p "${workdir}/app/releases"
    make_release_tree "$target_release"
    make_release_tree "$current_release"
    ln -s "$current_release" "${workdir}/app/current"
    ln -s "$target_release" "${workdir}/app/previous"
    dependency_hash="$(sha256sum "${target_release}/backend/package-lock.json" | cut -d ' ' -f 1)"

    stub_log="$(install_stub_commands "$workdir")"

    PATH="${workdir}/bin:${PATH}" \
    STUB_LOG="$stub_log" \
    APP_ROOT="${workdir}/app" \
    BACKEND_SERVICE_NAME="stub-backend.service" \
    READY_RETRIES=1 \
    bash "$ROLLBACK_SCRIPT"

    assert_exists "${workdir}/app/shared/uploads"
    assert_exists "${workdir}/app/shared/node_modules/backend-${dependency_hash}/node_modules"
    assert_symlink_target "${workdir}/app/current" "$target_release"
    assert_symlink_target "${workdir}/app/previous" "$current_release"
    assert_symlink_target "${workdir}/app/releases/release-target/backend/.data/uploads" "${workdir}/app/shared/uploads"
    assert_symlink_target "${workdir}/app/releases/release-target/backend/node_modules" "${workdir}/app/shared/node_modules/backend-${dependency_hash}/node_modules"
    assert_not_exists "${workdir}/app/releases/release-target/frontend/node_modules"
    assert_contains "$stub_log" "runuser -u novin -- env HOME="
    assert_contains "$stub_log" "npm ci --omit=dev --prefix "
    assert_line_count "$stub_log" '^npm ' 1
    assert_contains "$stub_log" "systemctl restart stub-backend.service"
    assert_contains "$stub_log" "curl --fail --silent --show-error http://127.0.0.1:8080/ready"
}

run_case_deploy_creates_runtime_upload_symlink
run_case_rollback_creates_runtime_upload_symlink

printf 'release runtime path tests: OK\n'
