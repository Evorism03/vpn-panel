#!/usr/bin/env bash
# Quick redeploy: pull latest source, sync it into the running install,
# rebuild + restart containers. Keeps .env and data/ untouched.
#
# Usage (on the server):
#   cd /path/to/vpn-panel   # your git checkout (this repo)
#   sudo bash scripts/update.sh
#
# Env overrides:
#   INSTALL_DIR   default /opt/vpn-panel  — where the running deployment lives
set -Eeuo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/vpn-panel}"
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo bash scripts/update.sh" >&2; exit 1; }
[ -d "$INSTALL_DIR/backend" ] || {
  echo "No existing install found at $INSTALL_DIR — run scripts/install.sh first." >&2
  exit 1
}

echo "→ Pulling latest source in $REPO_DIR"
git -C "$REPO_DIR" pull --ff-only

echo "→ Copying files into $INSTALL_DIR (.env and data/ are preserved)"
tar --exclude='.git' --exclude='.env' --exclude='data' \
    --exclude='backend/.venv' --exclude='frontend/node_modules' \
    --exclude='frontend/dist' --exclude='**/__pycache__' \
    -C "$REPO_DIR" -czf - . | tar -xzf - -C "$INSTALL_DIR"

echo "→ Rebuilding and restarting containers"
cd "$INSTALL_DIR"
docker compose up -d --build backend frontend caddy

echo "→ Waiting for health check (via Caddy, port 80)…"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1/api/health" >/dev/null 2>&1; then
    echo "✓ Panel online"
    break
  fi
  sleep 1
done

echo "✓ Update complete"
