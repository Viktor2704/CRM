#!/usr/bin/env bash
set -Eeuo pipefail

PRIMARY_DOMAIN="${NOVIN_TLS_PRIMARY_DOMAIN:-novinzhstroy.ru}"
DOMAINS="${NOVIN_TLS_DOMAINS:-novinzhstroy.ru www.novinzhstroy.ru}"
PRIMARY_IP="${NOVIN_TLS_PRIMARY_IP:-147.45.237.188}"
IP_ADDRESSES="${NOVIN_TLS_IP_ADDRESSES:-${PRIMARY_IP}}"
IP_CERT_NAME="${NOVIN_TLS_IP_CERT_NAME:-novinzhstroy-ip}"
EMAIL="${NOVIN_TLS_EMAIL:-info@novinzhstroy.ru}"
WEBROOT="${NOVIN_TLS_WEBROOT:-/var/www/_letsencrypt}"
APP_URL="${NOVIN_TLS_APP_URL:-https://${PRIMARY_DOMAIN}}"
CORS_ORIGINS="${NOVIN_TLS_CORS_ORIGINS:-https://${PRIMARY_DOMAIN}}"
IP_APP_URL="${NOVIN_TLS_IP_APP_URL:-https://${PRIMARY_IP}}"
IP_CORS_ORIGINS="${NOVIN_TLS_IP_CORS_ORIGINS:-https://${PRIMARY_IP}}"

ACTIVE_SITE="${NOVIN_TLS_ACTIVE_SITE:-/etc/nginx/sites-available/novinzhstroy.conf}"
HTTP_TEMPLATE="${NOVIN_TLS_HTTP_TEMPLATE:-/etc/novinzhstroy/nginx/novinzhstroy-http-bootstrap.conf}"
HTTPS_TEMPLATE="${NOVIN_TLS_HTTPS_TEMPLATE:-/etc/novinzhstroy/nginx/novinzhstroy-https.conf}"
HTTPS_IP_TEMPLATE="${NOVIN_TLS_HTTPS_IP_TEMPLATE:-/etc/novinzhstroy/nginx/novinzhstroy-ip-https.conf}"
BACKEND_ENV="${NOVIN_TLS_BACKEND_ENV:-/etc/novinzhstroy/backend.env}"
BACKEND_SERVICE="${NOVIN_TLS_BACKEND_SERVICE:-novinzhstroy-backend.service}"
STATE_DIR="${NOVIN_TLS_STATE_DIR:-/var/lib/novinzhstroy/tls}"
CERTBOT_BIN="${NOVIN_TLS_CERTBOT_BIN:-/usr/bin/certbot}"
NGINX_BIN="${NOVIN_TLS_NGINX_BIN:-/usr/sbin/nginx}"
MANUAL_AUTH_HOOK="${NOVIN_TLS_MANUAL_AUTH_HOOK:-/usr/local/sbin/novinzhstroy-certbot-http-auth.sh}"
MANUAL_CLEANUP_HOOK="${NOVIN_TLS_MANUAL_CLEANUP_HOOK:-/usr/local/sbin/novinzhstroy-certbot-http-cleanup.sh}"
DOMAIN_CERT_DIR="${NOVIN_TLS_DOMAIN_CERT_DIR:-/etc/letsencrypt/live/${PRIMARY_DOMAIN}}"
DOMAIN_FULLCHAIN_PATH="${NOVIN_TLS_DOMAIN_FULLCHAIN_PATH:-${DOMAIN_CERT_DIR}/fullchain.pem}"
DOMAIN_PRIVKEY_PATH="${NOVIN_TLS_DOMAIN_PRIVKEY_PATH:-${DOMAIN_CERT_DIR}/privkey.pem}"
IP_CERT_DIR="${NOVIN_TLS_IP_CERT_DIR:-/etc/letsencrypt/live/${IP_CERT_NAME}}"
IP_FULLCHAIN_PATH="${NOVIN_TLS_IP_FULLCHAIN_PATH:-${IP_CERT_DIR}/fullchain.pem}"
IP_PRIVKEY_PATH="${NOVIN_TLS_IP_PRIVKEY_PATH:-${IP_CERT_DIR}/privkey.pem}"

log() {
    printf '[novin-tls] %s\n' "$*"
}

require_binary() {
    local binary="$1"
    if [[ ! -x "$binary" ]]; then
        log "missing required binary: $binary"
        exit 1
    fi
}

collect_local_ips() {
    mapfile -t LOCAL_IPV4 < <(ip -o -4 addr show scope global | awk '{print $4}' | cut -d/ -f1 | sort -u)
    mapfile -t LOCAL_IPV6 < <(ip -o -6 addr show scope global | awk '{print $4}' | cut -d/ -f1 | grep -v '^fe80:' | sort -u || true)
}

ip_is_local() {
    local ip="$1"
    local candidate

    for candidate in "${LOCAL_IPV4[@]:-}"; do
        [[ "$ip" == "$candidate" ]] && return 0
    done

    for candidate in "${LOCAL_IPV6[@]:-}"; do
        [[ "$ip" == "$candidate" ]] && return 0
    done

    return 1
}

domain_points_only_here() {
    local domain="$1"
    local record
    local found=0

    mapfile -t DOMAIN_RECORDS < <(
        {
            dig +short A "$domain"
            dig +short AAAA "$domain"
        } | sed '/^$/d' | sort -u
    )

    if [[ "${#DOMAIN_RECORDS[@]}" -eq 0 ]]; then
        log "domain has no A/AAAA records yet: $domain"
        return 1
    fi

    for record in "${DOMAIN_RECORDS[@]}"; do
        found=1
        if ! ip_is_local "$record"; then
            log "domain points outside this host: $domain -> $record"
            return 1
        fi
    done

    [[ "$found" -eq 1 ]]
}

install_site_template() {
    local template="$1"
    local tmp backup

    if [[ ! -f "$template" ]]; then
        log "nginx template is missing: $template"
        return 1
    fi

    if cmp -s "$template" "$ACTIVE_SITE"; then
        return 0
    fi

    tmp="$(mktemp)"
    backup="$(mktemp)"

    cp -a "$ACTIVE_SITE" "$backup" 2>/dev/null || true
    install -m 0644 "$template" "$tmp"
    install -m 0644 "$tmp" "$ACTIVE_SITE"

    if "$NGINX_BIN" -t >/dev/null 2>&1; then
        systemctl reload nginx
        rm -f "$tmp" "$backup"
        log "activated nginx template $(basename "$template")"
        return 0
    fi

    if [[ -s "$backup" ]]; then
        install -m 0644 "$backup" "$ACTIVE_SITE"
        "$NGINX_BIN" -t >/dev/null
    fi

    rm -f "$tmp" "$backup"
    log "failed to activate nginx template $(basename "$template")"
    return 1
}

set_env_value() {
    local key="$1"
    local value="$2"
    local file="$3"
    local current escaped

    current="$(sed -n "s/^${key}=//p" "$file" | tail -n 1)"
    if [[ "$current" == "$value" ]]; then
        return 1
    fi

    escaped="$(printf '%s' "$value" | sed 's/[&|]/\\&/g')"
    if grep -q "^${key}=" "$file"; then
        sed -i "s|^${key}=.*|${key}=${escaped}|" "$file"
    else
        printf '\n%s=%s\n' "$key" "$value" >> "$file"
    fi

    return 0
}

ensure_backend_https_env() {
    local app_url="$1"
    local cors_origins="$2"
    local changed=0
    local backup_path=""

    [[ -f "$BACKEND_ENV" ]] || return 0

    backup_path="${BACKEND_ENV}.pre-tls-$(date -u +%Y%m%dT%H%M%SZ)"
    cp -a "$BACKEND_ENV" "$backup_path"

    if set_env_value "COOKIE_SECURE" "true" "$BACKEND_ENV"; then
        changed=1
    fi
    if set_env_value "APP_URL" "$app_url" "$BACKEND_ENV"; then
        changed=1
    fi
    if set_env_value "CORS_ORIGINS" "$cors_origins" "$BACKEND_ENV"; then
        changed=1
    fi

    if [[ "$changed" -eq 0 ]]; then
        rm -f "$backup_path"
        return 0
    fi

    log "saved backend env backup to $backup_path"
    systemctl restart "$BACKEND_SERVICE"
    log "restarted $BACKEND_SERVICE after HTTPS env update"
}

have_domain_cert() {
    [[ -f "$DOMAIN_FULLCHAIN_PATH" && -f "$DOMAIN_PRIVKEY_PATH" ]]
}

have_ip_cert() {
    [[ -f "$IP_FULLCHAIN_PATH" && -f "$IP_PRIVKEY_PATH" ]]
}

ensure_domain_https_mode() {
    have_domain_cert || return 1
    install_site_template "$HTTPS_TEMPLATE"
    ensure_backend_https_env "$APP_URL" "$CORS_ORIGINS"
}

ensure_ip_https_mode() {
    have_ip_cert || return 1
    install_site_template "$HTTPS_IP_TEMPLATE"
    ensure_backend_https_env "$IP_APP_URL" "$IP_CORS_ORIGINS"
}

certbot_supports_ip_certificates() {
    "$CERTBOT_BIN" certonly --help all 2>/dev/null | grep -q -- "--ip-address"
}

issue_domain_certificate() {
    local -a certbot_domain_args=()
    local domain

    for domain in $DOMAINS; do
        certbot_domain_args+=("-d" "$domain")
    done

    "$CERTBOT_BIN" certonly \
        --non-interactive \
        --agree-tos \
        --email "$EMAIL" \
        --webroot \
        --webroot-path "$WEBROOT" \
        --cert-name "$PRIMARY_DOMAIN" \
        --keep-until-expiring \
        "${certbot_domain_args[@]}"
}

issue_ip_certificate() {
    local -a certbot_ip_args=()
    local ip

    require_binary "$MANUAL_AUTH_HOOK"
    require_binary "$MANUAL_CLEANUP_HOOK"

    for ip in $IP_ADDRESSES; do
        if ! ip_is_local "$ip"; then
            log "configured IP address is not local: $ip"
            return 1
        fi
        certbot_ip_args+=("--ip-address" "$ip")
    done

    "$CERTBOT_BIN" certonly \
        --non-interactive \
        --agree-tos \
        --email "$EMAIL" \
        --manual \
        --preferred-challenges http-01 \
        --manual-auth-hook "$MANUAL_AUTH_HOOK" \
        --manual-cleanup-hook "$MANUAL_CLEANUP_HOOK" \
        --preferred-profile shortlived \
        --cert-name "$IP_CERT_NAME" \
        --keep-until-expiring \
        "${certbot_ip_args[@]}"
}

main() {
    local domain
    local domains_ready=0

    require_binary "$CERTBOT_BIN"
    require_binary "$NGINX_BIN"

    mkdir -p "$WEBROOT" "$STATE_DIR"
    collect_local_ips

    if have_domain_cert; then
        ensure_domain_https_mode
    elif have_ip_cert; then
        ensure_ip_https_mode
    else
        install_site_template "$HTTP_TEMPLATE"
    fi

    domains_ready=1
    for domain in $DOMAINS; do
        if ! domain_points_only_here "$domain"; then
            domains_ready=0
            break
        fi
    done

    if [[ "$domains_ready" -eq 1 ]]; then
        issue_domain_certificate
        ensure_domain_https_mode
        log "TLS ensure run completed in domain mode"
        return 0
    fi

    if certbot_supports_ip_certificates; then
        issue_ip_certificate
        ensure_ip_https_mode
        log "TLS ensure run completed in IP mode"
        return 0
    fi

    log "certbot does not support IP certificates and DNS is not ready; staying on HTTP bootstrap"
}

main "$@"
