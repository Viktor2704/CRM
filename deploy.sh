#!/bin/bash
set -e

# === Config ===
REPO_DIR="/home/ai_runner/CRM"
DEPLOY_DIR="/srv/novinzhstroy/current"
BACKEND_SERVICE="novinzhstroy-backend"

echo "=== CRM Deploy ==="
echo "$(date '+%Y-%m-%d %H:%M:%S')"

# 1. Pull latest from GitHub
echo ""
echo "[1/5] Pulling latest changes..."
cd "$REPO_DIR"
git pull origin main

# 2. Install backend dependencies
echo ""
echo "[2/5] Installing backend dependencies..."
cd "$REPO_DIR/backend"
npm ci --omit=dev

# 3. Build backend
echo ""
echo "[3/5] Building backend..."
npm run build

# 4. Install & build frontend
echo ""
echo "[4/5] Building frontend..."
cd "$REPO_DIR/frontend"
npm ci
npm run build

# 5. Deploy files
echo ""
echo "[5/5] Deploying..."

# Backend: sync source + dist (exclude uploads & .data)
sudo rsync -av --delete \
  --exclude='node_modules' \
  --exclude='.data' \
  --exclude='.env*' \
  --exclude='*.key' \
  --exclude='*.pem' \
  --exclude='.git' \
  "$REPO_DIR/backend/" "$DEPLOY_DIR/backend/"

# Install production deps in deploy dir
cd "$DEPLOY_DIR/backend"
sudo npm ci --omit=dev

# Frontend: sync built dist
sudo rsync -av --delete \
  "$REPO_DIR/frontend/dist/" "$DEPLOY_DIR/frontend-dist/dist/"

# Restart backend
sudo systemctl restart "$BACKEND_SERVICE"

echo ""
echo "=== Deploy complete! ==="
sudo systemctl status "$BACKEND_SERVICE" --no-pager -l | head -5
