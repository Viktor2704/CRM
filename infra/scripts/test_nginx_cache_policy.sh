#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

fail() {
    printf 'FAIL: %s\n' "$*" >&2
    exit 1
}

assert_contains() {
    local path="$1"
    local pattern="$2"
    grep -Fq -- "$pattern" "$path" || fail "expected '${pattern}' in ${path}"
}

http_template="${PROJECT_ROOT}/infra/nginx/novinzhstroy-http-bootstrap.conf"
https_template="${PROJECT_ROOT}/infra/nginx/novinzhstroy.conf"
ip_https_template="${PROJECT_ROOT}/infra/nginx/novinzhstroy-ip-https.conf"
http_security_snippet="${PROJECT_ROOT}/infra/nginx/snippets/novinzhstroy-security-headers.conf"
https_security_snippet="${PROJECT_ROOT}/infra/nginx/snippets/novinzhstroy-security-headers-https.conf"
http_cache_snippet="${PROJECT_ROOT}/infra/nginx/snippets/novinzhstroy-static-cache-policy-http.conf"
https_cache_snippet="${PROJECT_ROOT}/infra/nginx/snippets/novinzhstroy-static-cache-policy-https.conf"

assert_contains "$http_template" "include /etc/nginx/snippets/novinzhstroy-security-headers.conf;"
assert_contains "$http_template" "include /etc/nginx/snippets/novinzhstroy-static-cache-policy-http.conf;"
assert_contains "$http_template" 'add_header Cache-Control "no-cache, must-revalidate" always;'

assert_contains "$https_template" "include /etc/nginx/snippets/novinzhstroy-security-headers-https.conf;"
assert_contains "$https_template" "include /etc/nginx/snippets/novinzhstroy-static-cache-policy-https.conf;"
assert_contains "$https_template" 'add_header Cache-Control "no-cache, must-revalidate" always;'

assert_contains "$ip_https_template" "include /etc/nginx/snippets/novinzhstroy-security-headers-https.conf;"
assert_contains "$ip_https_template" "include /etc/nginx/snippets/novinzhstroy-static-cache-policy-https.conf;"
assert_contains "$ip_https_template" 'add_header Cache-Control "no-cache, must-revalidate" always;'

assert_contains "$http_security_snippet" 'add_header X-Content-Type-Options nosniff always;'
assert_contains "$http_security_snippet" "add_header Content-Security-Policy \"default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; frame-src 'self' blob: data: https:; img-src 'self' data: blob: https:; manifest-src 'self'; media-src 'self' data: blob: https:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self'\" always;"
assert_contains "$https_security_snippet" 'add_header Strict-Transport-Security "max-age=31536000" always;'

assert_contains "$http_cache_snippet" 'location = /index.html {'
assert_contains "$http_cache_snippet" 'location = /sw.js {'
assert_contains "$http_cache_snippet" 'location ~* "^/assets/.+-[A-Za-z0-9_-]{8,}\\.[^/]+$" {'
assert_contains "$http_cache_snippet" 'add_header Cache-Control "no-cache, must-revalidate" always;'
assert_contains "$http_cache_snippet" 'add_header Cache-Control "no-cache, no-store, must-revalidate" always;'
assert_contains "$http_cache_snippet" 'add_header Cache-Control "public, max-age=31536000, immutable" always;'
assert_contains "$http_cache_snippet" 'try_files /index.html =404;'
assert_contains "$http_cache_snippet" 'try_files /sw.js =404;'
assert_contains "$http_cache_snippet" 'try_files $uri =404;'

assert_contains "$https_cache_snippet" 'include /etc/nginx/snippets/novinzhstroy-security-headers-https.conf;'
assert_contains "$https_cache_snippet" 'add_header Cache-Control "no-cache, must-revalidate" always;'
assert_contains "$https_cache_snippet" 'add_header Cache-Control "no-cache, no-store, must-revalidate" always;'
assert_contains "$https_cache_snippet" 'add_header Cache-Control "public, max-age=31536000, immutable" always;'

printf 'nginx cache policy tests: OK\n'
