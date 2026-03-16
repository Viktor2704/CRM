#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SCRIPT_UNDER_TEST="${PROJECT_ROOT}/infra/scripts/ensure_tls.sh"

fail() {
    printf 'FAIL: %s\n' "$*" >&2
    exit 1
}

assert_contains() {
    local file="$1"
    local pattern="$2"
    grep -Fq -- "$pattern" "$file" || fail "expected '${pattern}' in ${file}"
}

assert_files_equal() {
    local left="$1"
    local right="$2"
    cmp -s "$left" "$right" || fail "expected ${left} to match ${right}"
}

make_stub_environment() {
    local workdir="$1"
    mkdir -p "$workdir/bin" "$workdir/templates" "$workdir/state" "$workdir/logs" "$workdir/certs/domain" "$workdir/certs/ip" "$workdir/etc"

    cat >"$workdir/bin/nginx" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

    cat >"$workdir/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${TEST_LOG_DIR}/systemctl.log"
exit 0
EOF

    cat >"$workdir/bin/ip" <<'EOF'
#!/usr/bin/env bash
cat <<'OUT'
2: eth0    inet 147.45.237.188/24 brd 147.45.237.255 scope global eth0
3: eth0    inet6 2a03:6f00:a::39a1/64 scope global
OUT
EOF

    cat >"$workdir/bin/dig" <<'EOF'
#!/usr/bin/env bash
if [[ "${TEST_DIG_MODE:-}" == "domain-ready" ]]; then
    printf '147.45.237.188\n'
fi
EOF

    cat >"$workdir/bin/certbot" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == *"--help all"* ]]; then
    printf '%s\n' "--ip-address"
    exit 0
fi

printf '%s\n' "$*" >> "${TEST_LOG_DIR}/certbot.log"

if [[ "$*" == *"--ip-address 147.45.237.188"* ]]; then
    mkdir -p "${NOVIN_TLS_IP_CERT_DIR}"
    printf 'ip-cert\n' > "${NOVIN_TLS_IP_FULLCHAIN_PATH}"
    printf 'ip-key\n' > "${NOVIN_TLS_IP_PRIVKEY_PATH}"
else
    mkdir -p "${NOVIN_TLS_DOMAIN_CERT_DIR}"
    printf 'domain-cert\n' > "${NOVIN_TLS_DOMAIN_FULLCHAIN_PATH}"
    printf 'domain-key\n' > "${NOVIN_TLS_DOMAIN_PRIVKEY_PATH}"
fi
EOF

    cat >"$workdir/bin/auth-hook" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

    cat >"$workdir/bin/cleanup-hook" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

    chmod +x "$workdir/bin/nginx" "$workdir/bin/systemctl" "$workdir/bin/ip" "$workdir/bin/dig" "$workdir/bin/certbot" "$workdir/bin/auth-hook" "$workdir/bin/cleanup-hook"

    cat >"$workdir/etc/backend.env" <<'EOF'
COOKIE_SECURE=false
APP_URL=http://147.45.237.188
CORS_ORIGINS=http://147.45.237.188
EOF

    printf 'http-template\n' >"$workdir/templates/http.conf"
    printf 'domain-template\n' >"$workdir/templates/domain.conf"
    printf 'ip-template\n' >"$workdir/templates/ip.conf"
    cp "$workdir/templates/http.conf" "$workdir/active.conf"
}

run_case_ip_fallback() {
    local workdir
    workdir="$(mktemp -d)"
    trap 'rm -rf "$workdir"' RETURN

    make_stub_environment "$workdir"

    PATH="$workdir/bin:$PATH" \
    TEST_LOG_DIR="$workdir/logs" \
    TEST_DIG_MODE="domain-missing" \
    NOVIN_TLS_CERTBOT_BIN="$workdir/bin/certbot" \
    NOVIN_TLS_NGINX_BIN="$workdir/bin/nginx" \
    NOVIN_TLS_MANUAL_AUTH_HOOK="$workdir/bin/auth-hook" \
    NOVIN_TLS_MANUAL_CLEANUP_HOOK="$workdir/bin/cleanup-hook" \
    NOVIN_TLS_ACTIVE_SITE="$workdir/active.conf" \
    NOVIN_TLS_HTTP_TEMPLATE="$workdir/templates/http.conf" \
    NOVIN_TLS_HTTPS_TEMPLATE="$workdir/templates/domain.conf" \
    NOVIN_TLS_HTTPS_IP_TEMPLATE="$workdir/templates/ip.conf" \
    NOVIN_TLS_BACKEND_ENV="$workdir/etc/backend.env" \
    NOVIN_TLS_BACKEND_SERVICE="novin-backend.service" \
    NOVIN_TLS_STATE_DIR="$workdir/state" \
    NOVIN_TLS_DOMAIN_CERT_DIR="$workdir/certs/domain" \
    NOVIN_TLS_DOMAIN_FULLCHAIN_PATH="$workdir/certs/domain/fullchain.pem" \
    NOVIN_TLS_DOMAIN_PRIVKEY_PATH="$workdir/certs/domain/privkey.pem" \
    NOVIN_TLS_IP_CERT_DIR="$workdir/certs/ip" \
    NOVIN_TLS_IP_FULLCHAIN_PATH="$workdir/certs/ip/fullchain.pem" \
    NOVIN_TLS_IP_PRIVKEY_PATH="$workdir/certs/ip/privkey.pem" \
    NOVIN_TLS_PRIMARY_DOMAIN="novinzhstroy.ru" \
    NOVIN_TLS_DOMAINS="novinzhstroy.ru www.novinzhstroy.ru" \
    NOVIN_TLS_PRIMARY_IP="147.45.237.188" \
    NOVIN_TLS_IP_ADDRESSES="147.45.237.188" \
    NOVIN_TLS_IP_CERT_NAME="novinzhstroy-ip" \
    NOVIN_TLS_IP_APP_URL="https://147.45.237.188" \
    NOVIN_TLS_IP_CORS_ORIGINS="https://147.45.237.188" \
    NOVIN_TLS_APP_URL="https://novinzhstroy.ru" \
    NOVIN_TLS_CORS_ORIGINS="https://novinzhstroy.ru,https://www.novinzhstroy.ru" \
    bash "$SCRIPT_UNDER_TEST"

    assert_files_equal "$workdir/active.conf" "$workdir/templates/ip.conf"
    assert_contains "$workdir/etc/backend.env" "COOKIE_SECURE=true"
    assert_contains "$workdir/etc/backend.env" "APP_URL=https://147.45.237.188"
    assert_contains "$workdir/etc/backend.env" "CORS_ORIGINS=https://147.45.237.188"
    assert_contains "$workdir/logs/certbot.log" "--manual"
    assert_contains "$workdir/logs/certbot.log" "--preferred-profile shortlived"
    assert_contains "$workdir/logs/certbot.log" "--ip-address 147.45.237.188"
}

run_case_domain_preferred() {
    local workdir
    workdir="$(mktemp -d)"
    trap 'rm -rf "$workdir"' RETURN

    make_stub_environment "$workdir"
    printf 'domain-cert\n' > "$workdir/certs/domain/fullchain.pem"
    printf 'domain-key\n' > "$workdir/certs/domain/privkey.pem"
    printf 'ip-cert\n' > "$workdir/certs/ip/fullchain.pem"
    printf 'ip-key\n' > "$workdir/certs/ip/privkey.pem"

    PATH="$workdir/bin:$PATH" \
    TEST_LOG_DIR="$workdir/logs" \
    TEST_DIG_MODE="domain-ready" \
    NOVIN_TLS_CERTBOT_BIN="$workdir/bin/certbot" \
    NOVIN_TLS_NGINX_BIN="$workdir/bin/nginx" \
    NOVIN_TLS_MANUAL_AUTH_HOOK="$workdir/bin/auth-hook" \
    NOVIN_TLS_MANUAL_CLEANUP_HOOK="$workdir/bin/cleanup-hook" \
    NOVIN_TLS_ACTIVE_SITE="$workdir/active.conf" \
    NOVIN_TLS_HTTP_TEMPLATE="$workdir/templates/http.conf" \
    NOVIN_TLS_HTTPS_TEMPLATE="$workdir/templates/domain.conf" \
    NOVIN_TLS_HTTPS_IP_TEMPLATE="$workdir/templates/ip.conf" \
    NOVIN_TLS_BACKEND_ENV="$workdir/etc/backend.env" \
    NOVIN_TLS_BACKEND_SERVICE="novin-backend.service" \
    NOVIN_TLS_STATE_DIR="$workdir/state" \
    NOVIN_TLS_DOMAIN_CERT_DIR="$workdir/certs/domain" \
    NOVIN_TLS_DOMAIN_FULLCHAIN_PATH="$workdir/certs/domain/fullchain.pem" \
    NOVIN_TLS_DOMAIN_PRIVKEY_PATH="$workdir/certs/domain/privkey.pem" \
    NOVIN_TLS_IP_CERT_DIR="$workdir/certs/ip" \
    NOVIN_TLS_IP_FULLCHAIN_PATH="$workdir/certs/ip/fullchain.pem" \
    NOVIN_TLS_IP_PRIVKEY_PATH="$workdir/certs/ip/privkey.pem" \
    NOVIN_TLS_PRIMARY_DOMAIN="novinzhstroy.ru" \
    NOVIN_TLS_DOMAINS="novinzhstroy.ru www.novinzhstroy.ru" \
    NOVIN_TLS_PRIMARY_IP="147.45.237.188" \
    NOVIN_TLS_IP_ADDRESSES="147.45.237.188" \
    NOVIN_TLS_IP_CERT_NAME="novinzhstroy-ip" \
    NOVIN_TLS_IP_APP_URL="https://147.45.237.188" \
    NOVIN_TLS_IP_CORS_ORIGINS="https://147.45.237.188" \
    NOVIN_TLS_APP_URL="https://novinzhstroy.ru" \
    NOVIN_TLS_CORS_ORIGINS="https://novinzhstroy.ru,https://www.novinzhstroy.ru" \
    bash "$SCRIPT_UNDER_TEST"

    assert_files_equal "$workdir/active.conf" "$workdir/templates/domain.conf"
    assert_contains "$workdir/etc/backend.env" "COOKIE_SECURE=true"
    assert_contains "$workdir/etc/backend.env" "APP_URL=https://novinzhstroy.ru"
    assert_contains "$workdir/etc/backend.env" "CORS_ORIGINS=https://novinzhstroy.ru,https://www.novinzhstroy.ru"
    assert_contains "$workdir/logs/certbot.log" "-d novinzhstroy.ru"
    assert_contains "$workdir/logs/certbot.log" "-d www.novinzhstroy.ru"
}

run_case_ip_fallback
run_case_domain_preferred

printf 'ensure_tls tests: OK\n'
