# Production Infrastructure

This folder contains deploy artifacts for:

- Nginx reverse proxy + TLS
- CORS/CSRF policy wiring
- Secret delivery from Vault
- PostgreSQL backup and restore verification
- Health/readiness operations
- CI/CD deploy and rollback flow

## 1. Frontend source of truth

Production Nginx must serve frontend static files from the active release artifact, while the active release also keeps the matching frontend sources for repeatable builds:

- primary path: `/srv/novinzhstroy/current/frontend-dist`
- source path: `/srv/novinzhstroy/current/frontend`
- legacy mirror only: `/srv/novinzhstroy/frontend`

Do not copy builds directly into `/srv/novinzhstroy/frontend`.

If a legacy mirror is required for diagnostics or temporary compatibility, sync it one-way from the active release artifact:

```bash
rsync -av --delete /srv/novinzhstroy/current/frontend-dist/ /srv/novinzhstroy/frontend/
```

## 2. Reverse Proxy + TLS

1. Run backend service on `127.0.0.1:8080`.
2. Install:
   - `infra/nginx/novinzhstroy-http-bootstrap.conf` -> `/etc/novinzhstroy/nginx/novinzhstroy-http-bootstrap.conf`
   - `infra/nginx/novinzhstroy.conf` -> `/etc/novinzhstroy/nginx/novinzhstroy-https.conf`
   - `infra/nginx/novinzhstroy-ip-https.conf` -> `/etc/novinzhstroy/nginx/novinzhstroy-ip-https.conf`
   - `infra/nginx/snippets/novinzhstroy-security-headers.conf` -> `/etc/nginx/snippets/novinzhstroy-security-headers.conf`
   - `infra/nginx/snippets/novinzhstroy-security-headers-https.conf` -> `/etc/nginx/snippets/novinzhstroy-security-headers-https.conf`
   - `infra/nginx/snippets/novinzhstroy-static-cache-policy-http.conf` -> `/etc/nginx/snippets/novinzhstroy-static-cache-policy-http.conf`
   - `infra/nginx/snippets/novinzhstroy-static-cache-policy-https.conf` -> `/etc/nginx/snippets/novinzhstroy-static-cache-policy-https.conf`
   - `infra/nginx/snippets/ssl-params.conf` -> `/etc/nginx/snippets/ssl-params.conf`
   - `infra/config/novinzhstroy-tls.env` -> `/etc/novinzhstroy/tls.env`
   - `infra/scripts/certbot_http_auth.sh` -> `/usr/local/sbin/novinzhstroy-certbot-http-auth.sh`
   - `infra/scripts/certbot_http_cleanup.sh` -> `/usr/local/sbin/novinzhstroy-certbot-http-cleanup.sh`
   - `infra/scripts/ensure_tls.sh` -> `/usr/local/sbin/novinzhstroy-tls-ensure.sh`
   - `infra/systemd/novinzhstroy-tls-ensure.service` -> `/etc/systemd/system/novinzhstroy-tls-ensure.service`
   - `infra/systemd/novinzhstroy-tls-ensure.timer` -> `/etc/systemd/system/novinzhstroy-tls-ensure.timer`
3. Install isolated Certbot with IP-certificate support and update `/etc/novinzhstroy/tls.env` (`NOVIN_TLS_CERTBOT_BIN`, domains, public IP, contact email):

```bash
sudo python3 -m venv /opt/novinzhstroy-certbot
sudo /opt/novinzhstroy-certbot/bin/pip install --upgrade pip certbot==5.3.1
```

4. Install HTTP bootstrap config first and reload:

```bash
sudo install -d /etc/novinzhstroy/nginx /var/www/_letsencrypt
sudo install -m 0644 /etc/novinzhstroy/nginx/novinzhstroy-http-bootstrap.conf /etc/nginx/sites-available/novinzhstroy.conf
sudo nginx -t
sudo systemctl reload nginx
```

5. Start the automation:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now novinzhstroy-tls-ensure.timer
sudo systemctl start novinzhstroy-tls-ensure.service
```

Behaviour:

- If domain DNS is ready, the ensure script issues or renews the domain certificate with `webroot` and switches nginx to the domain HTTPS template (`80 -> 443`, HSTS on `443`).
- If domain DNS is not ready yet, the ensure script requests a short-lived IP certificate for `NOVIN_TLS_IP_ADDRESSES` with manual HTTP-01 hooks and switches nginx to the IP HTTPS template so users are no longer served over plain HTTP.
- After successful activation, the ensure script atomically switches nginx to the selected HTTPS template, runs `nginx -t`, reloads nginx, and updates backend env:
  - `COOKIE_SECURE=true`
  - `APP_URL=https://<primary-domain>` in domain mode or `https://<primary-ip>` in IP mode
  - `CORS_ORIGINS` aligned with the active HTTPS entrypoint
- The same timer re-runs every 12 hours and renews with `certbot certonly --keep-until-expiring`; IP certificates use the `shortlived` profile.

Validation:

```bash
cd /root/novinzhstroy && ./infra/scripts/test_nginx_cache_policy.sh
sudo nginx -t
systemctl status novinzhstroy-tls-ensure.timer --no-pager
journalctl -u novinzhstroy-tls-ensure.service -n 50 --no-pager
```

## 3. CORS / CSRF Policy

Set backend env:

- `CORS_ORIGINS=https://app.example.com,https://www.app.example.com`
- `TRUST_PROXY=true`
- `COOKIE_SECURE=true`
- `COOKIE_SAME_SITE=lax` (or `none` for cross-site setup)
- `CSRF_PROTECTION_ENABLED=true`
- `CSRF_COOKIE_NAME=csrf_token`
- `CSRF_HEADER_NAME=x-csrf-token`

Frontend should call backend through Nginx path `/api`:

- `VITE_API_BASE_URL=/api`

Frontend already sends `x-csrf-token` automatically from the CSRF cookie for unsafe methods.

## 4. Secrets via Vault

Use template:

- `infra/secrets/backend.env.template`

Render real env file from Vault:

```bash
export VAULT_ADDR="https://vault.example.com"
export VAULT_TOKEN="***"
export VAULT_SECRET_PATH="kv/novinzhstroy/prod/backend"
infra/scripts/render-backend-env-from-vault.sh /etc/novinzhstroy/backend.env
```

Use `/etc/novinzhstroy/backend.env` in systemd service file.

## 5. Application Backups

Manual backup:

```bash
BACKUP_ROOT=/srv/backups/novinzhstroy APP_ROOT=/srv/novinzhstroy infra/scripts/app_backup.sh
```

Install the operational script and enable the timer:

```bash
install -d -m 0755 /srv/backups
install -d -m 0700 /srv/backups/novinzhstroy
install -m 0750 infra/scripts/app_backup.sh /usr/local/sbin/novinzhstroy-app-backup.sh
install -m 0644 infra/systemd/novinzhstroy-app-backup.service /etc/systemd/system/novinzhstroy-app-backup.service
install -m 0644 infra/systemd/novinzhstroy-app-backup.timer /etc/systemd/system/novinzhstroy-app-backup.timer
systemctl daemon-reload
systemctl enable --now novinzhstroy-app-backup.timer
```

The timer runs daily at `01:45 UTC`, stores compressed archives in `/srv/backups/novinzhstroy`, and keeps the last `7` days by default.

Each archive contains:

- active `current` release contents
- `previous` release contents when available
- `/srv/novinzhstroy/shared`
- `/etc/nginx/sites-available/novinzhstroy.conf`
- `/etc/systemd/system/novinzhstroy-backend.service`
- `/etc/novinzhstroy/backend.env`

Validation:

```bash
systemctl status novinzhstroy-app-backup.timer --no-pager
journalctl -u novinzhstroy-app-backup.service -n 50 --no-pager
ls -lah /srv/backups/novinzhstroy
```

## 6. PostgreSQL Backups

Manual backup:

```bash
BACKUP_DIR=/var/backups/postgres BACKEND_ENV_FILE=/etc/novinzhstroy/backend.env infra/scripts/postgres_backup.sh
```

Install the operational script and enable the timer:

```bash
install -m 0750 infra/scripts/postgres_backup.sh /usr/local/sbin/novinzhstroy-postgres-backup.sh
install -m 0644 infra/systemd/novinzhstroy-postgres-backup.service /etc/systemd/system/novinzhstroy-postgres-backup.service
install -m 0644 infra/systemd/novinzhstroy-postgres-backup.timer /etc/systemd/system/novinzhstroy-postgres-backup.timer
systemctl daemon-reload
systemctl enable --now novinzhstroy-postgres-backup.timer
```

The timer runs daily at `02:15 UTC`, stores dumps in `/var/backups/postgres`, and keeps the last `14` days by default.

Manual restore verification:

```bash
BACKUP_DIR=/var/backups/postgres BACKEND_ENV_FILE=/etc/novinzhstroy/backend.env infra/scripts/postgres_restore_verify.sh
```

Install the operational script and enable the weekly timer:

```bash
install -m 0750 infra/scripts/postgres_restore_verify.sh /usr/local/sbin/novinzhstroy-postgres-restore-verify.sh
install -m 0644 infra/systemd/novinzhstroy-postgres-restore-verify.service /etc/systemd/system/novinzhstroy-postgres-restore-verify.service
install -m 0644 infra/systemd/novinzhstroy-postgres-restore-verify.timer /etc/systemd/system/novinzhstroy-postgres-restore-verify.timer
systemctl daemon-reload
systemctl enable --now novinzhstroy-postgres-restore-verify.timer
```

The timer runs every Sunday at `03:00 UTC`, verifies the checksum of the newest dump, restores it into a disposable database named `novinzhstroy_restore_verify`, checks that user tables exist after restore, and then drops the verification database.

## 7. PostgreSQL Query Statistics

Enable `pg_stat_statements` with a dedicated Postgres config snippet:

```bash
install -d -m 0755 /etc/postgresql/16/main/conf.d
install -m 0644 infra/config/novinzhstroy-pg-stat-statements.conf /etc/postgresql/16/main/conf.d/novinzhstroy-pg-stat-statements.conf
pg_ctlcluster 16 main restart
sudo -u postgres psql -d novinzhstroy -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
```

This enables persistent statement statistics across restarts and tracks all statement types.

Collect recurring top SQL snapshots:

```bash
install -m 0750 infra/scripts/postgres_top_sql.sh /usr/local/sbin/novinzhstroy-postgres-top-sql.sh
install -m 0644 infra/systemd/novinzhstroy-postgres-top-sql.service /etc/systemd/system/novinzhstroy-postgres-top-sql.service
install -m 0644 infra/systemd/novinzhstroy-postgres-top-sql.timer /etc/systemd/system/novinzhstroy-postgres-top-sql.timer
systemctl daemon-reload
systemctl enable --now novinzhstroy-postgres-top-sql.timer
```

The timer runs every `15` minutes, stores CSV snapshots in `/var/log/novinzhstroy/postgres-top-sql`, keeps the last `7` days by default, and updates `/var/log/novinzhstroy/postgres-top-sql/latest.csv`.

Validation:

```bash
sudo -u postgres psql -d novinzhstroy -c "SHOW shared_preload_libraries;"
sudo -u postgres psql -d novinzhstroy -c "SELECT extname FROM pg_extension WHERE extname = 'pg_stat_statements';"
systemctl status novinzhstroy-postgres-top-sql.timer --no-pager
journalctl -u novinzhstroy-postgres-top-sql.service -n 20 --no-pager
head -n 5 /var/log/novinzhstroy/postgres-top-sql/latest.csv
```

## 8. Health / Ready and Logging

Backend endpoints:

- `GET /health` - liveness
- `GET /ready` - readiness (database check)

Logging/alerts:

- Structured JSON logs to stdout (`SERVICE_NAME`, `LOG_LEVEL`)
- Optional alert webhook (`ALERT_WEBHOOK_URL`)
- Alert cooldown (`ALERT_COOLDOWN_SECONDS`)
- Alert events:
  - auth errors
  - HTTP 5xx
- DB query/transaction failures
- readiness failures

## 9. CI/CD and Rollback

Workflow:

- `.github/workflows/ci-cd.yml`
  - build + typecheck + tests
  - frontend/backend build
  - deploy on `main`
  - manual rollback via `workflow_dispatch`

Server scripts:

- `infra/scripts/deploy_release.sh`
- `infra/scripts/rollback_release.sh`

`infra/scripts/build_release_bundle.sh` is the release source of truth: it copies backend sources and compiles a fresh `backend/dist` from `backend/src`, so manual edits in `dist/` must not be used as deploy input.

`deploy_release.sh` and `rollback_release.sh` keep release directories immutable after copy: they no longer run `npm ci` inside `/srv/novinzhstroy/current/*`. Backend runtime dependencies are hydrated into `/srv/novinzhstroy/shared/node_modules/backend-<sha256(package-lock)>` as user `novin`, and each release receives only a `backend/node_modules` symlink.

Required GitHub secrets:

- `PROD_HOST`
- `PROD_PORT`
- `PROD_USER`
- `PROD_SSH_KEY`
