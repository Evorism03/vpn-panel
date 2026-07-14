#!/usr/bin/env bash
set -Eeuo pipefail

# Best-effort UTF-8 locale so `read` doesn't mangle multi-byte (e.g. Cyrillic)
# input in the wizard. Never fatal — sanitize_utf8() below is the real guard.
if locale -a 2>/dev/null | grep -qi '^C\.utf8$\|^C\.UTF-8$'; then
  export LC_ALL="${LC_ALL:-C.UTF-8}" LANG="${LANG:-C.UTF-8}"
elif locale -a 2>/dev/null | grep -qi '^en_US\.utf8$\|^en_US\.UTF-8$'; then
  export LC_ALL="${LC_ALL:-en_US.UTF-8}" LANG="${LANG:-en_US.UTF-8}"
fi

# ─── Colours ──────────────────────────────────────────────────────────────────
if [ -t 1 ] && [ "${NO_COLOR:-}" = "" ]; then
  R='\033[0m'
  B='\033[1m'       DIM='\033[2m'     IT='\033[3m'
  GN='\033[0;32m'   BGN='\033[1;32m'
  CY='\033[0;36m'   BCY='\033[1;36m'
  BL='\033[0;34m'   BBL='\033[1;34m'
  MG='\033[0;35m'   BMG='\033[1;35m'
  YL='\033[0;33m'   BYL='\033[1;33m'
  RE='\033[0;31m'   BRE='\033[1;31m'
  WH='\033[1;37m'
else
  R=''; B=''; DIM=''; IT=''; GN=''; BGN=''; CY=''; BCY=''
  BL=''; BBL=''; MG=''; BMG=''; YL=''; BYL=''; RE=''; BRE=''; WH=''
fi

# ─── Defaults ─────────────────────────────────────────────────────────────────
APP_NAME="vpn-panel"
AWG_AUTO_INSTALL="${AWG_AUTO_INSTALL:-}"   # yes | no
AWG_UDP_PORT="${AWG_UDP_PORT:-51820}"
AWG_CONTAINER_NAME="${AWG_CONTAINER_NAME:-amnezia-awg}"
AWG_CONFIG_DIR="${AWG_CONFIG_DIR:-/opt/amnezia/awg}"

WDTT_PORT="${WDTT_PORT:-56000}"
WDTT_WG_PORT="${WDTT_WG_PORT:-56001}"
WDTT_PASSWORD="${WDTT_PASSWORD:-}"
WDTT_INSTALL="${WDTT_INSTALL:-}"   # yes | no
INSTALL_DIR="${INSTALL_DIR:-/opt/vpn-panel}"
PROJECT_SRC="${PROJECT_SRC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/opt/vpn-panel-backups}"

PANEL_HTTP_PORT="${PANEL_HTTP_PORT:-8080}"
PANEL_HTTP_BIND="${PANEL_HTTP_BIND:-0.0.0.0}"
BACKEND_PORT="${BACKEND_PORT:-8090}"
BACKEND_BIND="${BACKEND_BIND:-127.0.0.1}"
NETWORK_NAME="${NETWORK_NAME:-vpn-panel-net}"

BACKEND_CONTAINER="${BACKEND_CONTAINER:-vpn-panel-backend}"
FRONTEND_CONTAINER="${FRONTEND_CONTAINER:-vpn-panel-frontend}"

SKIP_DOCKER_INSTALL="${SKIP_DOCKER_INSTALL:-0}"
FORCE_PORT="${FORCE_PORT:-0}"
ACTION_MODE="${ACTION_MODE:-}"
INSTALL_MODE="${INSTALL_MODE:-}"   # panel | agent

STEP_N=0
STEP_TOTAL=7
_SPIN_PID=''

# ─── Detection cache (populated once by detect_environment) ───────────────────
_DETECTED_IP=""
_DETECTED_AWG_CONTAINER=""
_DETECTED_AWG_PORT=""
_DETECTED_AWG_CONFIG=""

# ─── Logging ──────────────────────────────────────────────────────────────────
log()      { printf "     ${BGN}✓${R}  %s\n" "$*"; }
log_dim()  { printf "     ${DIM}·  %s${R}\n" "$*"; }
log_warn() { printf "     ${BYL}⚠${R}  ${YL}%s${R}\n" "$*"; }
log_info() { printf "     ${BCY}→${R}  %s\n" "$*"; }

step() {
  STEP_N=$(( STEP_N + 1 ))
  local bar="" i=1
  while [ "$i" -le "$STEP_TOTAL" ]; do
    if   [ "$i" -lt  "$STEP_N" ]; then bar="${bar}${BGN}━${R}"
    elif [ "$i" -eq "$STEP_N" ]; then bar="${bar}${BCY}●${R}"
    else bar="${bar}${DIM}─${R}"; fi
    i=$(( i + 1 ))
  done
  printf "\n"
  printf "  ${DIM}┌─────────────────────────────────────────────────┐${R}\n"
  printf "  ${DIM}│${R}  ${bar}  ${DIM}%d/%d${R}  ${B}%s${R}\n" "$STEP_N" "$STEP_TOTAL" "$*"
  printf "  ${DIM}└─────────────────────────────────────────────────┘${R}\n\n"
}

fail() {
  spin_stop 2>/dev/null || true
  printf "\n"
  printf "  ${BRE}┌─ ERROR ──────────────────────────────────────────┐${R}\n"
  printf "  ${BRE}│${R}  ${RE}%s${R}\n" "$*"
  printf "  ${BRE}└──────────────────────────────────────────────────┘${R}\n\n"
  exit 1
}

# ─── Spinner ──────────────────────────────────────────────────────────────────
spin_start() {
  [ -t 1 ] || return 0
  local msg="${1:-}"
  ( local -a f=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏'); local n=0
    while true; do
      printf "\r     ${BCY}%s${R}  ${DIM}%s${R}   " "${f[$n]}" "$msg"
      n=$(( (n+1) % 10 )); sleep 0.1
    done ) &
  _SPIN_PID=$!
}

spin_stop() {
  if [ -n "$_SPIN_PID" ]; then
    kill "$_SPIN_PID" 2>/dev/null || true
    wait "$_SPIN_PID" 2>/dev/null || true
    _SPIN_PID=''; printf "\r\033[2K"
  fi
}

trap 'spin_stop 2>/dev/null || true' EXIT

# ─── Banner ───────────────────────────────────────────────────────────────────
banner() {
  printf "\n"
  printf "  ${BCY}╔══════════════════════════════════════════════════╗${R}\n"
  printf "  ${BCY}║${R}                                                  ${BCY}║${R}\n"
  printf "  ${BCY}║${R}    ${WH}  ██╗   ██╗██████╗ ███╗   ██╗${R}               ${BCY}║${R}\n"
  printf "  ${BCY}║${R}    ${WH}  ██║   ██║██╔══██╗████╗  ██║${R}               ${BCY}║${R}\n"
  printf "  ${BCY}║${R}    ${WH}  ██║   ██║██████╔╝██╔██╗ ██║${R}               ${BCY}║${R}\n"
  printf "  ${BCY}║${R}    ${WH}  ╚██╗ ██╔╝██╔═══╝ ██║╚██╗██║${R}               ${BCY}║${R}\n"
  printf "  ${BCY}║${R}    ${WH}   ╚████╔╝ ██║     ██║ ╚████║${R}               ${BCY}║${R}\n"
  printf "  ${BCY}║${R}    ${WH}    ╚═══╝  ╚═╝     ╚═╝  ╚═══╝${R}               ${BCY}║${R}\n"
  printf "  ${BCY}║${R}                                                  ${BCY}║${R}\n"
  printf "  ${BCY}║${R}    ${DIM}AmneziaWG  ·  Multi-admin  ·  Lava Pay${R}       ${BCY}║${R}\n"
  printf "  ${BCY}║${R}    ${BCY}Installer${R} ${DIM}v2${R}                                  ${BCY}║${R}\n"
  printf "  ${BCY}║${R}                                                  ${BCY}║${R}\n"
  printf "  ${BCY}╚══════════════════════════════════════════════════╝${R}\n\n"
}

require_root() {
  [ "$(id -u)" -eq 0 ] || fail "Run as root: sudo bash scripts/install.sh"
}

have_cmd() { command -v "$1" >/dev/null 2>&1; }

# ─── Docker ───────────────────────────────────────────────────────────────────
install_docker_if_missing() {
  if have_cmd docker; then
    log "Docker $(docker --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' | head -1)"
    return
  fi
  [ "$SKIP_DOCKER_INSTALL" = "1" ] && fail "Docker missing. Install it first."
  have_cmd apt-get || fail "Auto-install only supports apt-get systems."
  step "Installing Docker"
  apt-get update -qq
  if apt-get install -y -qq ca-certificates curl gnupg 2>/dev/null; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg \
      | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null \
      && chmod a+r /etc/apt/keyrings/docker.gpg \
      && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") \
$(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      > /etc/apt/sources.list.d/docker.list \
      && apt-get update -qq \
      && apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin \
      && systemctl enable --now docker \
      && log "Docker CE installed" && return
  fi
  apt-get install -y -qq docker.io && systemctl enable --now docker
  log "Docker installed"
}

compose_cmd() {
  docker compose version >/dev/null 2>&1 && { printf 'docker compose'; return; }
  have_cmd docker-compose && { printf 'docker-compose'; return; }
  printf ''
}

# ─── Port check ───────────────────────────────────────────────────────────────
port_busy() {
  local port="$1"
  if have_cmd ss;      then ss -ltn "sport = :$port"  | awk 'NR>1{f=1}END{exit f?0:1}'; return; fi
  if have_cmd netstat; then netstat -ltn | awk -v p=":$port" '$4~p"$"{f=1}END{exit f?0:1}'; return; fi
  return 1
}

check_ports() {
  [ "$FORCE_PORT" = "1" ] && return
  if port_busy "$PANEL_HTTP_PORT"; then
    local owner; owner="$(docker ps --filter "publish=$PANEL_HTTP_PORT" --format '{{.Names}}' 2>/dev/null | head -1 || true)"
    [ "$owner" = "$FRONTEND_CONTAINER" ] || fail "Port $PANEL_HTTP_PORT busy. Use PANEL_HTTP_PORT=8081 or FORCE_PORT=1."
  fi
  if port_busy "$BACKEND_PORT"; then
    local owner; owner="$(docker ps --filter "publish=$BACKEND_PORT" --format '{{.Names}}' 2>/dev/null | head -1 || true)"
    [ "$owner" = "$BACKEND_CONTAINER" ] || fail "Port $BACKEND_PORT busy. Use BACKEND_PORT=8091 or FORCE_PORT=1."
  fi
}

# ─── Detection ────────────────────────────────────────────────────────────────
_valid_ipv4() { printf '%s' "$1" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; }

# Fetch IP from one service into a file (runs in background)
_fetch_ip_to_file() {
  local svc="$1" out="$2" ip=""
  if have_cmd curl; then
    ip="$(curl -s --connect-timeout 3 --max-time 4 "$svc" 2>/dev/null | tr -d '[:space:]' || true)"
  elif have_cmd wget; then
    ip="$(wget -qO- --timeout=4 "$svc" 2>/dev/null | tr -d '[:space:]' || true)"
  fi
  _valid_ipv4 "$ip" && printf '%s' "$ip" > "$out" || true
}

# Run all detections in parallel and populate _DETECTED_* globals.
# Called once at startup — wizard and write_env read the cached values.
detect_environment() {
  local tmp; tmp="$(mktemp -d)"

  # ── IP: race all three services simultaneously ─────────────────────────────
  _fetch_ip_to_file "https://api.ipify.org"   "$tmp/ip1" &
  _fetch_ip_to_file "https://ifconfig.me"     "$tmp/ip2" &
  _fetch_ip_to_file "https://icanhazip.com"   "$tmp/ip3" &
  local ip_pids="$!"   # last pid; we'll just wait below

  # ── AWG container (fast, local docker call) ────────────────────────────────
  if [ -n "${AWG_DOCKER_CONTAINER:-}" ]; then
    printf '%s' "$AWG_DOCKER_CONTAINER" > "$tmp/awg"
  else
    docker ps --format '{{.Names}}' 2>/dev/null \
      | grep -E 'amnezia.*awg|^awg[0-9]*$|^awg[-_]' \
      | grep -Ev '^vpn-panel' | head -1 > "$tmp/awg" &
  fi

  # ── Wait for IP (up to 5 s) ────────────────────────────────────────────────
  local deadline=$(( $(date +%s) + 5 )) ip=""
  while [ "$(date +%s)" -lt "$deadline" ] && [ -z "$ip" ]; do
    for f in "$tmp/ip1" "$tmp/ip2" "$tmp/ip3"; do
      [ -s "$f" ] && { ip="$(cat "$f")"; _valid_ipv4 "$ip" && break 2 || ip=""; }
    done
    sleep 0.1
  done
  # Kill leftover IP fetchers
  jobs -p | xargs kill 2>/dev/null || true
  wait 2>/dev/null || true

  if ! _valid_ipv4 "$ip"; then
    ip="$(ip route get 1.1.1.1 2>/dev/null \
      | awk '/src/{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1);exit}}' || true)"
    _valid_ipv4 "$ip" || ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  _DETECTED_IP="${ip:-127.0.0.1}"

  local awg_container=""
  [ -f "$tmp/awg" ] && awg_container="$(cat "$tmp/awg" 2>/dev/null || true)"
  _DETECTED_AWG_CONTAINER="$awg_container"

  # ── AWG port + config path in parallel (need container name first) ─────────
  if [ -n "$awg_container" ]; then
    if [ -n "${AWG_PORT:-}" ]; then
      printf '%s' "$AWG_PORT" > "$tmp/port"
    else
      docker port "$awg_container" 2>/dev/null \
        | awk -F: '/udp/ {print $NF; exit}' > "$tmp/port" &
    fi

    if [ -n "${AWG_CONTAINER_CONFIG_PATH:-}" ]; then
      printf '%s' "$AWG_CONTAINER_CONFIG_PATH" > "$tmp/cfg"
    else
      local iface="${AWG_INTERFACE:-awg0}"
      docker exec "$awg_container" sh -c '
        for p in \
          "/opt/amnezia/awg/$1.conf" "/opt/amnezia/amneziawg/$1.conf" \
          "/etc/amnezia/amneziawg/$1.conf" "/etc/wireguard/$1.conf" \
          "/config/$1.conf" "/opt/amnezia/awg/awg0.conf" \
          "/etc/wireguard/awg0.conf" "/etc/wireguard/wg0.conf"; do
          [ -f "$p" ] && printf "%s" "$p" && exit 0
        done
        find /opt/amnezia /etc/amnezia /etc/wireguard /config \
          -maxdepth 4 -name "*.conf" 2>/dev/null | head -1
      ' sh "$iface" > "$tmp/cfg" 2>/dev/null &
    fi

    wait 2>/dev/null || true
    _DETECTED_AWG_PORT="$(cat "$tmp/port" 2>/dev/null || true)"
    _DETECTED_AWG_CONFIG="$(cat "$tmp/cfg" 2>/dev/null || true)"
  fi

  rm -rf "$tmp"
}

# Thin wrappers kept for compatibility (read from cache)
detect_awg_container()   { printf '%s' "$_DETECTED_AWG_CONTAINER"; }
detect_udp_port()        { printf '%s' "$_DETECTED_AWG_PORT"; }
detect_public_ip()       { printf '%s' "$_DETECTED_IP"; }
detect_awg_config_path() { printf '%s' "$_DETECTED_AWG_CONFIG"; }

iface_from_path() { basename "$1" .conf; }

gen_secret() {
  if have_cmd openssl; then
    openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
  else
    head -c 48 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=' | head -c 43
  fi
}

# Drop invalid UTF-8 byte sequences from a file in place (e.g. multi-byte
# chars truncated by a non-UTF-8 terminal during `read`). Docker refuses to
# load an env file containing invalid UTF-8, so this must run before use.
sanitize_utf8() {
  local f="$1"
  have_cmd iconv || return 0
  local tmp; tmp="$(mktemp)"
  if iconv -f UTF-8 -t UTF-8 -c "$f" > "$tmp" 2>/dev/null; then
    mv "$tmp" "$f"
  else
    rm -f "$tmp"
  fi
}

# ─── File copy ────────────────────────────────────────────────────────────────
copy_project() {
  step "Installing files"
  mkdir -p "$INSTALL_DIR" "$BACKUP_DIR"
  if [ -d "$INSTALL_DIR/backend" ]; then
    local ts; ts="$(date +%Y%m%d-%H%M%S)"
    spin_start "Backing up existing installation…"
    tar -czf "$BACKUP_DIR/vpn-panel-$ts.tar.gz" -C "$(dirname "$INSTALL_DIR")" "$(basename "$INSTALL_DIR")"
    spin_stop
    log_dim "Saved → $BACKUP_DIR/vpn-panel-$ts.tar.gz"
  fi
  spin_start "Copying project files…"
  tar --exclude='.git' --exclude='.env' --exclude='data' \
      --exclude='backend/.venv' --exclude='frontend/node_modules' \
      --exclude='frontend/dist' --exclude='**/__pycache__' \
      -C "$PROJECT_SRC" -czf - . \
    | tar -xzf - -C "$INSTALL_DIR"
  spin_stop
  mkdir -p "$INSTALL_DIR/data"
  log "Files installed  ${DIM}→ $INSTALL_DIR${R}"
}

# ─── .env helpers ─────────────────────────────────────────────────────────────
env_value() {
  [ -f "$INSTALL_DIR/.env" ] || return 0
  sed -n "s/^${1}=//p" "$INSTALL_DIR/.env" | head -1
}

set_env_key() {
  local f="$1" k="$2" v="$3"
  if grep -q "^${k}=" "$f"; then sed -i "s|^${k}=.*|${k}=${v}|" "$f"
  else printf '%s=%s\n' "$k" "$v" >> "$f"; fi
}

ensure_env_key() {
  grep -q "^${2}=" "$1" || printf '%s=%s\n' "$2" "$3" >> "$1"
}

# ─── Write .env ───────────────────────────────────────────────────────────────
write_env() {
  local env_path="$INSTALL_DIR/.env"

  if [ -f "$env_path" ]; then
    log_info "Existing config preserved"
    ensure_env_key "$env_path" "PRICE_1M"   "${PRICE_1M:-199}"
    ensure_env_key "$env_path" "PRICE_3M"   "${PRICE_3M:-499}"
    ensure_env_key "$env_path" "PRICE_6M"   "${PRICE_6M:-899}"
    ensure_env_key "$env_path" "PRICE_1Y"   "${PRICE_1Y:-1499}"
    ensure_env_key "$env_path" "PANEL_NAME" "${PANEL_NAME:-VPN Panel}"
    ensure_env_key "$env_path" "LAVA_API_KEY" ""
    ensure_env_key "$env_path" "LAVA_SHOP_ID" ""
    ensure_env_key "$env_path" "WDTT_SERVER"   ""
    ensure_env_key "$env_path" "WDTT_PASSWORD" ""
    sanitize_utf8 "$env_path"
    chmod 600 "$env_path"
    return
  fi

  step "Creating configuration"

  # All detections already ran in parallel at startup — just read the cache
  local awg_container="$_DETECTED_AWG_CONTAINER"
  local awg_port="$_DETECTED_AWG_PORT"
  local server_ip="$_DETECTED_IP"
  local awg_config_path="$_DETECTED_AWG_CONFIG"

  [ -n "$awg_container" ]  || fail "AmneziaWG container not found. Run with AWG_DOCKER_CONTAINER=<name>."
  [ -n "$awg_config_path" ] || fail "AWG config not found in container '$awg_container'."

  log_dim "Container  →  $awg_container"
  log_dim "Public IP  →  $server_ip"
  log_dim "AWG config →  $awg_config_path"
  [ -n "$awg_port" ] && log_dim "UDP port   →  $awg_port" \
    || log_warn "AWG UDP port not detected — update SERVER_ENDPOINT in .env later"

  local awg_iface; awg_iface="${AWG_INTERFACE:-$(iface_from_path "$awg_config_path")}"
  local server_endpoint="${SERVER_ENDPOINT:-}"
  [ -z "$server_endpoint" ] && [ -n "$awg_port" ] && server_endpoint="$server_ip:$awg_port"
  [ -n "$server_endpoint" ] || server_endpoint="$server_ip:"

  local secret_key;     secret_key="$(gen_secret)"
  local admin_password; admin_password="$(gen_secret | cut -c1-20)"

  cat > "$env_path" <<EOF
# ── Auth ──────────────────────────────────────────────────────────────────────
SECRET_KEY=$secret_key
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=30
ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
ADMIN_PASSWORD=$admin_password

# ── AWG ───────────────────────────────────────────────────────────────────────
AWG_CONFIG_PATH=${AWG_CONFIG_PATH:-$awg_config_path}
AWG_INTERFACE=$awg_iface
AWG_BIN=${AWG_BIN:-awg}
AWG_DOCKER_CONTAINER=$awg_container
AWG_CONTAINER_CONFIG_PATH=$awg_config_path
MOCK_AWG=false

# ── Client defaults ───────────────────────────────────────────────────────────
SERVER_ENDPOINT=$server_endpoint
CLIENT_DNS=${CLIENT_DNS:-1.1.1.1}
CLIENT_ALLOWED_IPS=${CLIENT_ALLOWED_IPS:-0.0.0.0/0,::/0}
CLIENT_PERSISTENT_KEEPALIVE=${CLIENT_PERSISTENT_KEEPALIVE:-25}

# ── Data ──────────────────────────────────────────────────────────────────────
DATA_DIR=/data
DB_PATH=/data/vpn.db

# ── Lava ──────────────────────────────────────────────────────────────────────
LAVA_API_KEY=${LAVA_API_KEY:-}
LAVA_SHOP_ID=${LAVA_SHOP_ID:-}
LAVA_SUCCESS_URL=${LAVA_SUCCESS_URL:-http://$server_ip:$PANEL_HTTP_PORT/cabinet}
LAVA_FAIL_URL=${LAVA_FAIL_URL:-http://$server_ip:$PANEL_HTTP_PORT}

# ── Pricing (RUB) ─────────────────────────────────────────────────────────────
PRICE_1M=${PRICE_1M:-199}
PRICE_3M=${PRICE_3M:-499}
PRICE_6M=${PRICE_6M:-899}
PRICE_1Y=${PRICE_1Y:-1499}

# ── Branding ──────────────────────────────────────────────────────────────────
PANEL_NAME=${PANEL_NAME:-VPN Panel}
PANEL_DOMAIN=${PANEL_DOMAIN:-}

# ── WDTT ──────────────────────────────────────────────────────────────────────
WDTT_SERVER=${server_ip}:${WDTT_PORT}
WDTT_PASSWORD=${WDTT_PASSWORD:-}
EOF
  sanitize_utf8 "$env_path"
  chmod 600 "$env_path"
  log "Config written  ${DIM}→ $env_path${R}"
}

# ─── Start ────────────────────────────────────────────────────────────────────
start_containers() {
  local cmd="$1"
  step "Building & starting containers"
  cd "$INSTALL_DIR"
  docker network inspect "$NETWORK_NAME" >/dev/null 2>&1 \
    || docker network create "$NETWORK_NAME" >/dev/null
  docker rm -f "$FRONTEND_CONTAINER" "$BACKEND_CONTAINER" >/dev/null 2>&1 || true
  spin_start "Building images…"
  $cmd up -d --build backend frontend caddy >/dev/null 2>&1
  spin_stop
  log "Containers started"
}

start_manually() {
  step "Building & starting containers"
  docker network inspect "$NETWORK_NAME" >/dev/null 2>&1 \
    || docker network create "$NETWORK_NAME" >/dev/null
  docker rm -f "$FRONTEND_CONTAINER" "$BACKEND_CONTAINER" >/dev/null 2>&1 || true

  # Build backend and frontend in parallel
  local _log_be _log_fe
  _log_be="$(mktemp)" _log_fe="$(mktemp)"

  spin_start "Building backend & frontend in parallel…"
  docker build -t vpn-panel-backend  "$INSTALL_DIR/backend"  >"$_log_be" 2>&1 &
  local be_pid=$!
  docker build -t vpn-panel-frontend "$INSTALL_DIR/frontend" >"$_log_fe" 2>&1 &
  local fe_pid=$!

  wait $be_pid || { spin_stop; cat "$_log_be" >&2; rm -f "$_log_be" "$_log_fe"; fail "Backend build failed"; }
  wait $fe_pid || { spin_stop; cat "$_log_fe" >&2; rm -f "$_log_be" "$_log_fe"; fail "Frontend build failed"; }
  spin_stop; rm -f "$_log_be" "$_log_fe"
  log "Images built"

  docker run -d --name "$BACKEND_CONTAINER" --restart unless-stopped \
    --network "$NETWORK_NAME" --network-alias backend \
    --env-file "$INSTALL_DIR/.env" \
    -v "$INSTALL_DIR/data:/data" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -p "$BACKEND_BIND:$BACKEND_PORT:8090" \
    vpn-panel-backend >/dev/null
  log "Backend running  ${DIM}→ $BACKEND_BIND:$BACKEND_PORT${R}"

  docker run -d --name "$FRONTEND_CONTAINER" --restart unless-stopped \
    --network "$NETWORK_NAME" \
    -p "$PANEL_HTTP_BIND:$PANEL_HTTP_PORT:80" \
    vpn-panel-frontend >/dev/null
  log "Frontend running  ${DIM}→ :$PANEL_HTTP_PORT${R}"
}

# ─── Healthcheck ──────────────────────────────────────────────────────────────
healthcheck() {
  step "Health check"
  spin_start "Waiting for backend…"
  local attempt=0 delay="0.3" elapsed="0"
  while true; do
    attempt=$(( attempt + 1 ))
    if curl -fsS "http://127.0.0.1:$BACKEND_PORT/api/health" >/dev/null 2>&1 \
      || wget -q -O /dev/null "http://127.0.0.1:$BACKEND_PORT/api/health" 2>/dev/null; then
      spin_stop; log "Backend  ${BGN}online${R}  ${DIM}(~${elapsed}s)${R}"; break
    fi
    [ "$attempt" -ge 50 ] && {
      spin_stop
      docker logs --tail 40 "$BACKEND_CONTAINER" >&2 || true
      fail "Backend did not start in time"
    }
    sleep "$delay"
    elapsed="$(awk "BEGIN{printf \"%.0f\", $elapsed + $delay}")"
    # Exponential backoff: 0.3 → 0.4 → 0.6 → … → max 2.0s
    delay="$(awk "BEGIN{d=$delay*1.4; print (d>2)?2:d}")"
  done

  spin_start "Checking frontend…"
  local fdelay="0.3" fatt=0
  while true; do
    fatt=$(( fatt + 1 ))
    if curl -fsSI "http://127.0.0.1:$PANEL_HTTP_PORT" >/dev/null 2>&1 \
      || wget -q --spider "http://127.0.0.1:$PANEL_HTTP_PORT" 2>/dev/null; then
      spin_stop; log "Frontend  ${BGN}online${R}"; break
    fi
    [ "$fatt" -ge 20 ] && {
      spin_stop; log_warn "Frontend check failed — run: docker logs $FRONTEND_CONTAINER"; break
    }
    sleep "$fdelay"
    fdelay="$(awk "BEGIN{d=$fdelay*1.5; print (d>2)?2:d}")"
  done
}

# ─── Interactive wizard ───────────────────────────────────────────────────────
_prompt() {
  # _prompt "Label" "default" → prints styled prompt, reads answer into _ANS
  local label="$1" default="$2"
  printf "  ${DIM}│${R}  ${B}%-22s${R}  ${DIM}[${CY}%s${DIM}]${R}  " "$label" "$default"
  read -r _ANS
  _ANS="${_ANS:-$default}"
}

_prompt_secret() {
  local label="$1"
  printf "  ${DIM}│${R}  ${B}%-22s${R}  ${DIM}[${CY}auto-generated${DIM}]${R}  " "$label"
  read -r -s _ANS; printf "\n"
}

wizard() {
  [ -t 0 ] && [ "${INTERACTIVE:-1}" != "0" ] || return 0

  step "Configuration wizard"

  # Read from cache — detect_environment() ran before wizard
  local _ip="$_DETECTED_IP"
  local _awg="$_DETECTED_AWG_CONTAINER"
  local _wgp="$_DETECTED_AWG_PORT"

  printf "  ${DIM}┌──────────────────────────────────────────────────┐${R}\n"
  printf "  ${DIM}│${R}  ${IT}${DIM}Press Enter to accept the default in brackets${R}     ${DIM}│${R}\n"
  printf "  ${DIM}├──────────────────────────────────────────────────┤${R}\n"
  printf "  ${DIM}│${R}  ${DIM}Server${R}\n"

  _prompt "Public IP"          "$_ip";                     SERVER_IP="$_ANS"
  _prompt "Panel port (HTTP)"  "$PANEL_HTTP_PORT";         PANEL_HTTP_PORT="$_ANS"

  printf "  ${DIM}│${R}\n"
  printf "  ${DIM}│${R}  ${DIM}AmneziaWG${R}\n"

  if [ -z "$_awg" ]; then
    printf "  ${DIM}│${R}  ${B}%-22s${R}  ${DIM}[${CY}%s${DIM}]${R}  " "Установить AWG?" "yes"
    read -r _ANS; _ANS="${_ANS:-yes}"
    case "$_ANS" in y|yes|Y|YES) AWG_AUTO_INSTALL="yes" ;; *) AWG_AUTO_INSTALL="no" ;; esac
  else
    AWG_AUTO_INSTALL="no"
    log_dim "AWG уже запущен: $_awg"
  fi

  if [ "$AWG_AUTO_INSTALL" = "yes" ]; then
    _prompt "AWG UDP порт"      "$AWG_UDP_PORT";           AWG_UDP_PORT="$_ANS"
    _prompt "AWG контейнер"     "$AWG_CONTAINER_NAME";     AWG_CONTAINER_NAME="$_ANS"
    AWG_DOCKER_CONTAINER="$AWG_CONTAINER_NAME"
    AWG_PORT="$AWG_UDP_PORT"
  else
    _prompt "AWG container"     "${_awg:-amnezia-awg}";    AWG_DOCKER_CONTAINER="$_ANS"
    _prompt "AWG UDP port"      "${_wgp:-?}";              AWG_PORT="$_ANS"
    [ -n "$AWG_PORT" ] || log_warn "AWG port not set — update SERVER_ENDPOINT in .env later"
  fi

  printf "  ${DIM}│${R}\n"
  printf "  ${DIM}│${R}  ${DIM}Admin account${R}\n"

  _prompt       "Username"     "admin";                    ADMIN_USERNAME="$_ANS"
  _prompt_secret "Password";                               [ -n "$_ANS" ] && ADMIN_PASSWORD="$_ANS"
  _prompt        "Panel name"  "VPN Panel";                PANEL_NAME="$_ANS"

  printf "  ${DIM}│${R}\n"
  printf "  ${DIM}│${R}  ${DIM}Pricing (RUB)  ·  0 = hide plan${R}\n"

  _prompt "1 month"   "199";  PRICE_1M="$_ANS"
  _prompt "3 months"  "499";  PRICE_3M="$_ANS"
  _prompt "6 months"  "899";  PRICE_6M="$_ANS"
  _prompt "1 year"    "1499"; PRICE_1Y="$_ANS"

  printf "  ${DIM}│${R}\n"
  printf "  ${DIM}│${R}  ${DIM}Lava payments${R}  ${DIM}(Enter to skip)${R}\n"

  _prompt "Lava API Key" ""; LAVA_API_KEY="$_ANS"
  if [ -n "$LAVA_API_KEY" ]; then
    _prompt "Lava Shop ID" ""; LAVA_SHOP_ID="$_ANS"
    printf "  ${DIM}│${R}  ${BGN}✓${R}  Lava configured\n"
  else
    printf "  ${DIM}│${R}  ${DIM}·  Lava skipped — add keys to .env later${R}\n"
  fi

  printf "  ${DIM}│${R}\n"
  printf "  ${DIM}│${R}  ${DIM}WDTT (WireGuard over VK TURN)${R}\n"

  printf "  ${DIM}│${R}  ${B}%-22s${R}  ${DIM}[${CY}%s${DIM}]${R}  " "Установить WDTT?" "yes"
  read -r _ANS; _ANS="${_ANS:-yes}"
  case "$_ANS" in y|yes|Y|YES) WDTT_INSTALL="yes" ;; *) WDTT_INSTALL="no" ;; esac

  if [ "$WDTT_INSTALL" = "yes" ]; then
    _prompt "WDTT порт (UDP)"    "$WDTT_PORT";     WDTT_PORT="$_ANS"
    _prompt_secret "Мастер-пароль WDTT";           [ -n "$_ANS" ] && WDTT_PASSWORD="$_ANS"
    [ -n "$WDTT_PASSWORD" ] || WDTT_PASSWORD="$(gen_secret | cut -c1-24)"
    _prompt "Telegram admin ID"  "";               WDTT_ADMIN_ID="$_ANS"
    _prompt "Telegram bot token" "";               WDTT_BOT_TOKEN="$_ANS"
  fi

  printf "  ${DIM}└──────────────────────────────────────────────────┘${R}\n\n"
}

# ─── AWG install ──────────────────────────────────────────────────────────────
install_awg() {
  [ "$AWG_AUTO_INSTALL" = "yes" ] || return 0

  step "Установка AmneziaWG"

  local cfg_dir="$AWG_CONFIG_DIR"
  mkdir -p "$cfg_dir"

  # Generate server keys inside a temporary awg container
  spin_start "Загружаем образ amneziavpn/amneziawg…"
  docker pull amneziavpn/amneziawg >/dev/null 2>&1
  spin_stop
  log "Образ загружен"

  spin_start "Генерируем ключи сервера…"
  local priv_key pub_key
  priv_key="$(docker run --rm amneziavpn/amneziawg awg genkey 2>/dev/null)"
  pub_key="$(printf '%s' "$priv_key" | docker run --rm -i amneziavpn/amneziawg awg pubkey 2>/dev/null)"
  spin_stop

  # Random AmneziaWG obfuscation params
  rand_int() { shuf -i "${1}-${2}" -n 1 2>/dev/null || awk -v a="$1" -v b="$2" 'BEGIN{srand();print int(a+rand()*(b-a+1))}'; }
  local Jc Jmin Jmax S1 S2 H1 H2 H3 H4
  Jc="$(rand_int 3 10)"
  Jmin="$(rand_int 50 150)"
  Jmax="$(rand_int 200 900)"
  S1="$(rand_int 15 50)"
  S2="$(rand_int 15 50)"
  H1="$(rand_int 1000000 2147483647)"
  H2="$(rand_int 1000000 2147483647)"
  H3="$(rand_int 1000000 2147483647)"
  H4="$(rand_int 1000000 2147483647)"

  cat > "$cfg_dir/awg0.conf" <<EOF
[Interface]
PrivateKey = $priv_key
Address = 10.8.1.1/24
ListenPort = $AWG_UDP_PORT
Jc = $Jc
Jmin = $Jmin
Jmax = $Jmax
S1 = $S1
S2 = $S2
H1 = $H1
H2 = $H2
H3 = $H3
H4 = $H4
EOF
  chmod 600 "$cfg_dir/awg0.conf"
  log "Конфиг создан  ${DIM}→ $cfg_dir/awg0.conf${R}"

  # Stop old container if exists
  docker rm -f "$AWG_CONTAINER_NAME" >/dev/null 2>&1 || true

  spin_start "Запускаем контейнер $AWG_CONTAINER_NAME…"
  docker run -d \
    --name "$AWG_CONTAINER_NAME" \
    --restart unless-stopped \
    --cap-add NET_ADMIN \
    --cap-add SYS_MODULE \
    --sysctl net.ipv4.ip_forward=1 \
    --device /dev/net/tun \
    -v "$cfg_dir:/opt/amnezia/awg" \
    -p "$AWG_UDP_PORT:$AWG_UDP_PORT/udp" \
    amneziavpn/amneziawg >/dev/null 2>&1
  spin_stop
  log "Контейнер запущен  ${DIM}→ $AWG_CONTAINER_NAME:$AWG_UDP_PORT/udp${R}"

  # Update detection cache so write_env picks it up
  _DETECTED_AWG_CONTAINER="$AWG_CONTAINER_NAME"
  _DETECTED_AWG_PORT="$AWG_UDP_PORT"
  _DETECTED_AWG_CONFIG="$cfg_dir/awg0.conf"

  # Open firewall
  if have_cmd ufw; then
    ufw allow "${AWG_UDP_PORT}/udp" >/dev/null 2>&1 || true
    log_dim "ufw: открыт ${AWG_UDP_PORT}/udp"
  elif have_cmd firewall-cmd; then
    firewall-cmd --permanent --add-port="${AWG_UDP_PORT}/udp" >/dev/null 2>&1 || true
    firewall-cmd --reload >/dev/null 2>&1 || true
    log_dim "firewalld: открыт ${AWG_UDP_PORT}/udp"
  fi

  log "${BGN}AmneziaWG готов${R}  ${DIM}PublicKey: $pub_key${R}"
}

# ─── WDTT install ─────────────────────────────────────────────────────────────
install_wdtt() {
  [ "$WDTT_INSTALL" = "yes" ] || return 0

  step "Установка WDTT сервера"

  local bin_src="$PROJECT_SRC/scripts/wdtt-server"
  [ -f "$bin_src" ] || { log_warn "wdtt-server binary not found, skipping"; return 0; }

  spin_start "Устанавливаем wdtt-server…"
  systemctl stop wdtt >/dev/null 2>&1 || true
  # Copy to a temp file then rename — avoids "Text file busy" if the old
  # binary is still mapped/running (rename replaces the inode atomically).
  cp "$bin_src" /usr/local/bin/wdtt-server.new
  chmod +x /usr/local/bin/wdtt-server.new
  mv -f /usr/local/bin/wdtt-server.new /usr/local/bin/wdtt-server
  mkdir -p /etc/wdtt
  spin_stop
  log "Binary  ${DIM}→ /usr/local/bin/wdtt-server${R}"

  # systemd service
  cat > /etc/systemd/system/wdtt.service <<EOF
[Unit]
Description=WDTT - WireGuard over VK TURN Tunnel
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/wdtt-server \\
  -listen 0.0.0.0:${WDTT_PORT} \\
  -wg-port ${WDTT_WG_PORT} \\
  -config-dir /etc/wdtt \\
  -password ${WDTT_PASSWORD} \\
  ${WDTT_ADMIN_ID:+-admin ${WDTT_ADMIN_ID} \\}
  ${WDTT_BOT_TOKEN:+-bot-token ${WDTT_BOT_TOKEN}}
Restart=on-failure
RestartSec=5
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable wdtt >/dev/null 2>&1
  systemctl restart wdtt
  spin_stop

  # Firewall
  if have_cmd ufw; then
    ufw allow "${WDTT_PORT}/udp" >/dev/null 2>&1 || true
    ufw allow "${WDTT_WG_PORT}/udp" >/dev/null 2>&1 || true
    log_dim "ufw: открыт ${WDTT_PORT}/udp и ${WDTT_WG_PORT}/udp"
  elif have_cmd firewall-cmd; then
    firewall-cmd --permanent --add-port="${WDTT_PORT}/udp" >/dev/null 2>&1 || true
    firewall-cmd --permanent --add-port="${WDTT_WG_PORT}/udp" >/dev/null 2>&1 || true
    firewall-cmd --reload >/dev/null 2>&1 || true
    log_dim "firewalld: открыт ${WDTT_PORT}/udp и ${WDTT_WG_PORT}/udp"
  fi

  # Write password to file for reference
  printf '%s\n' "$WDTT_PASSWORD" > /etc/wdtt/master_password
  chmod 600 /etc/wdtt/master_password

  log "WDTT сервер запущен  ${DIM}→ 0.0.0.0:${WDTT_PORT}${R}"
}

print_wdtt_summary() {
  [ "$WDTT_INSTALL" = "yes" ] || return 0
  local server_ip; server_ip="$(detect_public_ip)"
  printf "  ${BGN}║${R}\n"
  printf "  ${BGN}║${R}   ${DIM}WDTT${R}\n"
  printf "  ${BGN}║${R}   ${DIM}───────────────────────────────────────────${R}\n"
  printf "  ${BGN}║${R}   ${DIM}Адрес VPS    ${R}  ${WH}%s:%s${R}\n"  "$server_ip" "$WDTT_PORT"
  printf "  ${BGN}║${R}   ${DIM}Пароль       ${R}  ${BYL}%s${R}\n"    "$WDTT_PASSWORD"
  printf "  ${BGN}║${R}   ${DIM}Статус       ${R}  systemctl status wdtt\n"
  printf "  ${BGN}║${R}   ${DIM}Логи         ${R}  journalctl -u wdtt -f\n"
}

# ─── Action selector ──────────────────────────────────────────────────────────
select_action() {
  [ -d "$INSTALL_DIR/backend" ] || { ACTION_MODE="install"; return; }
  [ -t 0 ] && [ "${INTERACTIVE:-1}" != "0" ] || { ACTION_MODE="${ACTION_MODE:-update}"; return; }

  printf "  ${BCY}╔══════════════════════════════════════════════════╗${R}\n"
  printf "  ${BCY}║${R}  ${BYL}⚠${R}  Panel already installed at ${CY}%s${R}\n" "$INSTALL_DIR"
  printf "  ${BCY}╠══════════════════════════════════════════════════╣${R}\n"
  printf "  ${BCY}║${R}  ${BCY}1${R}  ${B}Update${R}          ${DIM}rebuild containers, keep .env & data${R}\n"
  printf "  ${BCY}║${R}  ${BCY}2${R}  ${B}Reinstall${R}       ${DIM}re-run wizard, keep client data${R}\n"
  printf "  ${BCY}║${R}  ${BCY}3${R}  ${B}Full reinstall${R}  ${DIM}wipe everything, start fresh${R}\n"
  printf "  ${BCY}║${R}  ${BCY}0${R}  Exit\n"
  printf "  ${BCY}╚══════════════════════════════════════════════════╝${R}\n"
  printf "\n  ${B}Choice${R}  ${DIM}[${CY}1${DIM}]${R}  "
  local _ans; read -r _ans
  case "${_ans:-1}" in
    2) ACTION_MODE="reinstall" ;;
    3) ACTION_MODE="full_reinstall" ;;
    0) exit 0 ;;
    *) ACTION_MODE="update" ;;
  esac
}

wipe_data() {
  step "Wiping data"
  local ts; ts="$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BACKUP_DIR"
  [ -d "$INSTALL_DIR/data" ] && {
    spin_start "Backing up data…"
    tar -czf "$BACKUP_DIR/vpn-panel-data-$ts.tar.gz" -C "$INSTALL_DIR" data 2>/dev/null || true
    spin_stop
    rm -rf "$INSTALL_DIR/data"
    log_dim "Data saved → $BACKUP_DIR/vpn-panel-data-$ts.tar.gz"
  }
  rm -f "$INSTALL_DIR/.env"
  log "Wiped"
}

# ─── Summary ──────────────────────────────────────────────────────────────────
print_summary() {
  local username;   username="$(env_value ADMIN_USERNAME)"
  local password;   password="$(env_value ADMIN_PASSWORD)"
  local endpoint;   endpoint="$(env_value SERVER_ENDPOINT)"
  local awg_cont;   awg_cont="$(env_value AWG_DOCKER_CONTAINER)"
  local panel_name; panel_name="$(env_value PANEL_NAME)"
  local server_ip;  server_ip="$(detect_public_ip)"
  local panel_url="http://$server_ip:$PANEL_HTTP_PORT"

  printf "\n"
  printf "  ${BGN}╔══════════════════════════════════════════════════╗${R}\n"
  printf "  ${BGN}║${R}  ${BGN}✓${R}  ${WH}Installation complete!${R}                        ${BGN}║${R}\n"
  printf "  ${BGN}╠══════════════════════════════════════════════════╣${R}\n"
  printf "  ${BGN}║${R}\n"
  printf "  ${BGN}║${R}   ${DIM}URLS${R}\n"
  printf "  ${BGN}║${R}   ${DIM}───────────────────────────────────────────${R}\n"
  printf "  ${BGN}║${R}   ${DIM}Panel     ${R}  ${BCY}%s${R}\n"        "$panel_url"
  printf "  ${BGN}║${R}   ${DIM}Admin     ${R}  ${CY}%s/admin${R}\n"   "$panel_url"
  printf "  ${BGN}║${R}   ${DIM}Shop      ${R}  ${CY}%s/${R}\n"        "$panel_url"
  printf "  ${BGN}║${R}   ${DIM}Cabinet   ${R}  ${CY}%s/cabinet${R}\n" "$panel_url"
  printf "  ${BGN}║${R}\n"
  printf "  ${BGN}║${R}   ${DIM}CREDENTIALS${R}\n"
  printf "  ${BGN}║${R}   ${DIM}───────────────────────────────────────────${R}\n"
  printf "  ${BGN}║${R}   ${DIM}Username  ${R}  ${WH}%s${R}\n"         "${username:-admin}"
  printf "  ${BGN}║${R}   ${DIM}Password  ${R}  ${BYL}%s${R}\n"        "$password"
  printf "  ${BGN}║${R}\n"
  printf "  ${BGN}║${R}   ${DIM}AWG${R}\n"
  printf "  ${BGN}║${R}   ${DIM}───────────────────────────────────────────${R}\n"
  printf "  ${BGN}║${R}   ${DIM}Endpoint  ${R}  %s\n"                  "$endpoint"
  printf "  ${BGN}║${R}   ${DIM}Container ${R}  %s\n"                  "$awg_cont"
  printf "  ${BGN}║${R}\n"
  print_wdtt_summary
  printf "  ${BGN}╠══════════════════════════════════════════════════╣${R}\n"
  printf "  ${BGN}║${R}  ${DIM}Config:  nano %s/.env${R}\n"            "$INSTALL_DIR"
  printf "  ${BGN}║${R}  ${DIM}Logs:    docker logs -f %s${R}\n"       "$BACKEND_CONTAINER"
  printf "  ${BGN}╚══════════════════════════════════════════════════╝${R}\n\n"
}

# ─── Install mode selector ────────────────────────────────────────────────────
select_install_mode() {
  # Skip if already set via env var or not interactive
  [ -n "$INSTALL_MODE" ] && return 0
  [ -t 0 ] && [ "${INTERACTIVE:-1}" != "0" ] || { INSTALL_MODE="panel"; return; }

  printf "  ${BCY}╔══════════════════════════════════════════════════╗${R}\n"
  printf "  ${BCY}║${R}  ${B}Выберите режим установки${R}                         ${BCY}║${R}\n"
  printf "  ${BCY}╠══════════════════════════════════════════════════╣${R}\n"
  printf "  ${BCY}║${R}  ${BCY}1${R}  ${B}Главная панель${R}  ${DIM}фронтенд + бэкенд, полный UI${R}\n"
  printf "  ${BCY}║${R}  ${BCY}2${R}  ${B}Агент (доп. сервер)${R}  ${DIM}только бэкенд, добавляется${R}\n"
  printf "  ${BCY}║${R}     ${DIM}в главную панель через Серверы → Добавить${R}\n"
  printf "  ${BCY}╚══════════════════════════════════════════════════╝${R}\n"
  printf "\n  ${B}Choice${R}  ${DIM}[${CY}1${DIM}]${R}  "
  local _ans; read -r _ans
  case "${_ans:-1}" in
    2) INSTALL_MODE="agent" ;;
    *) INSTALL_MODE="panel" ;;
  esac
  printf "\n"
}

# ─── Agent wizard (shorter — no pricing/lava/panel_name) ─────────────────────
wizard_agent() {
  [ -t 0 ] && [ "${INTERACTIVE:-1}" != "0" ] || return 0

  step "Конфигурация агента"

  local _ip="$_DETECTED_IP"
  local _awg="$_DETECTED_AWG_CONTAINER"
  local _wgp="$_DETECTED_AWG_PORT"

  printf "  ${DIM}┌──────────────────────────────────────────────────┐${R}\n"
  printf "  ${DIM}│${R}  ${IT}${DIM}Press Enter to accept the default in brackets${R}     ${DIM}│${R}\n"
  printf "  ${DIM}├──────────────────────────────────────────────────┤${R}\n"
  printf "  ${DIM}│${R}  ${DIM}Сервер${R}\n"

  _prompt "Public IP"          "$_ip";              SERVER_IP="$_ANS"
  _prompt "Backend port"       "$BACKEND_PORT";     BACKEND_PORT="$_ANS"

  printf "  ${DIM}│${R}\n"
  printf "  ${DIM}│${R}  ${DIM}AmneziaWG${R}\n"

  _prompt "AWG container"      "${_awg:-amnezia-awg}"; AWG_DOCKER_CONTAINER="$_ANS"
  _prompt "AWG UDP port"       "${_wgp:-?}";            AWG_PORT="$_ANS"

  printf "  ${DIM}│${R}\n"
  printf "  ${DIM}│${R}  ${DIM}Доступ${R}\n"

  _prompt "Max clients (0=∞)"  "0";                 MAX_USERS_AGENT="$_ANS"

  printf "  ${DIM}└──────────────────────────────────────────────────┘${R}\n\n"

  # Agent backend must be reachable from the network
  BACKEND_BIND="0.0.0.0"
}

# ─── Write .env for agent (no frontend, no pricing, no lava) ─────────────────
write_env_agent() {
  local env_path="$INSTALL_DIR/.env"

  if [ -f "$env_path" ]; then
    log_info "Existing config preserved"
    sanitize_utf8 "$env_path"
    chmod 600 "$env_path"
    return
  fi

  step "Создание конфигурации агента"

  local awg_container="$_DETECTED_AWG_CONTAINER"
  local awg_port="$_DETECTED_AWG_PORT"
  local server_ip="$_DETECTED_IP"
  local awg_config_path="$_DETECTED_AWG_CONFIG"

  [ -n "$awg_container" ]   || fail "AmneziaWG container not found."
  [ -n "$awg_config_path" ] || fail "AWG config not found in container '$awg_container'."

  log_dim "Container  →  $awg_container"
  log_dim "Public IP  →  $server_ip"
  log_dim "AWG config →  $awg_config_path"

  local awg_iface="${AWG_INTERFACE:-$(iface_from_path "$awg_config_path")}"
  local server_endpoint="${SERVER_ENDPOINT:-}"
  [ -z "$server_endpoint" ] && [ -n "$awg_port" ] && server_endpoint="$server_ip:$awg_port"
  [ -n "$server_endpoint" ] || server_endpoint="$server_ip:"

  local secret_key; secret_key="$(gen_secret)"
  local admin_password; admin_password="$(gen_secret | cut -c1-20)"

  cat > "$env_path" <<EOF
# ── Auth ──────────────────────────────────────────────────────────────────────
SECRET_KEY=$secret_key
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=30
ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
ADMIN_PASSWORD=$admin_password

# ── AWG ───────────────────────────────────────────────────────────────────────
AWG_CONFIG_PATH=${AWG_CONFIG_PATH:-$awg_config_path}
AWG_INTERFACE=$awg_iface
AWG_BIN=${AWG_BIN:-awg}
AWG_DOCKER_CONTAINER=$awg_container
AWG_CONTAINER_CONFIG_PATH=$awg_config_path
MOCK_AWG=false

# ── Client defaults ───────────────────────────────────────────────────────────
SERVER_ENDPOINT=$server_endpoint
CLIENT_DNS=${CLIENT_DNS:-1.1.1.1}
CLIENT_ALLOWED_IPS=${CLIENT_ALLOWED_IPS:-0.0.0.0/0,::/0}
CLIENT_PERSISTENT_KEEPALIVE=${CLIENT_PERSISTENT_KEEPALIVE:-25}

# ── Data ──────────────────────────────────────────────────────────────────────
DATA_DIR=/data
DB_PATH=/data/vpn.db

# ── Agent mode (no shop/lava) ─────────────────────────────────────────────────
LAVA_API_KEY=
LAVA_SHOP_ID=
PRICE_1M=0
PRICE_3M=0
PRICE_6M=0
PRICE_1Y=0
PANEL_NAME=Agent
EOF
  sanitize_utf8 "$env_path"
  chmod 600 "$env_path"
  log "Config written  ${DIM}→ $env_path${R}"
}

# ─── Start agent (backend only, bound to 0.0.0.0) ────────────────────────────
start_agent() {
  step "Запуск агента"
  docker network inspect "$NETWORK_NAME" >/dev/null 2>&1 \
    || docker network create "$NETWORK_NAME" >/dev/null
  docker rm -f "$BACKEND_CONTAINER" >/dev/null 2>&1 || true

  local _log; _log="$(mktemp)"
  spin_start "Building backend image…"
  docker build -t vpn-panel-backend "$INSTALL_DIR/backend" >"$_log" 2>&1 || {
    spin_stop; cat "$_log" >&2; rm -f "$_log"; fail "Backend build failed"; }
  spin_stop; rm -f "$_log"; log "Backend image built"

  docker run -d --name "$BACKEND_CONTAINER" --restart unless-stopped \
    --network "$NETWORK_NAME" --network-alias backend \
    --env-file "$INSTALL_DIR/.env" \
    -v "$INSTALL_DIR/data:/data" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -p "${BACKEND_BIND:-0.0.0.0}:$BACKEND_PORT:8090" \
    vpn-panel-backend >/dev/null
  log "Agent running  ${DIM}→ 0.0.0.0:$BACKEND_PORT${R}"
}

# ─── Healthcheck agent ────────────────────────────────────────────────────────
healthcheck_agent() {
  step "Health check"
  spin_start "Waiting for backend…"
  local attempt=0 delay="0.3" elapsed="0"
  while true; do
    attempt=$(( attempt + 1 ))
    if curl -fsS "http://127.0.0.1:$BACKEND_PORT/api/health" >/dev/null 2>&1 \
      || wget -q -O /dev/null "http://127.0.0.1:$BACKEND_PORT/api/health" 2>/dev/null; then
      spin_stop; log "Backend  ${BGN}online${R}  ${DIM}(~${elapsed}s)${R}"; break
    fi
    [ "$attempt" -ge 50 ] && {
      spin_stop; docker logs --tail 40 "$BACKEND_CONTAINER" >&2 || true
      fail "Backend did not start in time"
    }
    sleep "$delay"
    elapsed="$(awk "BEGIN{printf \"%.0f\", $elapsed + $delay}")"
    delay="$(awk "BEGIN{d=$delay*1.4; print (d>2)?2:d}")"
  done
}

# ─── Summary agent ────────────────────────────────────────────────────────────
print_summary_agent() {
  local token;      token="$(env_value SECRET_KEY)"
  local endpoint;   endpoint="$(env_value SERVER_ENDPOINT)"
  local awg_cont;   awg_cont="$(env_value AWG_DOCKER_CONTAINER)"
  local server_ip;  server_ip="$(detect_public_ip)"
  local agent_url="http://$server_ip:$BACKEND_PORT"

  printf "\n"
  printf "  ${BGN}╔══════════════════════════════════════════════════╗${R}\n"
  printf "  ${BGN}║${R}  ${BGN}✓${R}  ${WH}Агент установлен!${R}                             ${BGN}║${R}\n"
  printf "  ${BGN}╠══════════════════════════════════════════════════╣${R}\n"
  printf "  ${BGN}║${R}\n"
  printf "  ${BGN}║${R}   ${DIM}ДОБАВИТЬ В ГЛАВНУЮ ПАНЕЛЬ${R}\n"
  printf "  ${BGN}║${R}   ${DIM}───────────────────────────────────────────${R}\n"
  printf "  ${BGN}║${R}   ${DIM}Серверы → Добавить сервер${R}\n"
  printf "  ${BGN}║${R}\n"
  printf "  ${BGN}║${R}   ${DIM}Panel URL ${R}  ${BCY}%s${R}\n"  "$agent_url"
  printf "  ${BGN}║${R}   ${DIM}Token     ${R}  ${BYL}%s${R}\n"  "$token"
  printf "  ${BGN}║${R}\n"
  printf "  ${BGN}║${R}   ${DIM}AWG${R}\n"
  printf "  ${BGN}║${R}   ${DIM}───────────────────────────────────────────${R}\n"
  printf "  ${BGN}║${R}   ${DIM}Endpoint  ${R}  %s\n"            "$endpoint"
  printf "  ${BGN}║${R}   ${DIM}Container ${R}  %s\n"            "$awg_cont"
  printf "  ${BGN}║${R}\n"
  printf "  ${BGN}╠══════════════════════════════════════════════════╣${R}\n"
  printf "  ${BGN}║${R}  ${BYL}⚠${R}  ${YL}Открой порт $BACKEND_PORT в firewall!${R}\n"
  printf "  ${BGN}║${R}  ${DIM}ufw allow $BACKEND_PORT/tcp${R}\n"
  printf "  ${BGN}╠══════════════════════════════════════════════════╣${R}\n"
  printf "  ${BGN}║${R}  ${DIM}Config:  nano %s/.env${R}\n"  "$INSTALL_DIR"
  printf "  ${BGN}║${R}  ${DIM}Logs:    docker logs -f %s${R}\n" "$BACKEND_CONTAINER"
  printf "  ${BGN}╚══════════════════════════════════════════════════╝${R}\n\n"
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
  banner
  require_root
  install_docker_if_missing

  # Run all environment detections in parallel before wizard or config writing
  spin_start "Detecting environment…"
  detect_environment
  spin_stop

  # Choose panel vs agent (only on fresh install or if INSTALL_MODE unset)
  [ -d "$INSTALL_DIR/backend" ] || select_install_mode

  # ── Agent mode ──────────────────────────────────────────────────────────────
  if [ "${INSTALL_MODE:-panel}" = "agent" ]; then
    [ -d "$INSTALL_DIR/backend" ] || true  # agents can be updated too
    wizard_agent
    copy_project
    write_env_agent
    start_agent
    healthcheck_agent
    print_summary_agent
    return
  fi

  # ── Panel mode (default) ────────────────────────────────────────────────────
  select_action

  case "$ACTION_MODE" in
    full_reinstall) wipe_data; wizard ;;
    reinstall)      rm -f "$INSTALL_DIR/.env"; wizard ;;
    update)         ;;
    *)              wizard ;;
  esac

  check_ports
  install_awg
  copy_project
  write_env

  local cmd; cmd="$(compose_cmd)"
  if [ -n "$cmd" ]; then
    start_containers "$cmd"
  else
    start_manually
  fi

  healthcheck
  install_wdtt
  print_summary
}

main "$@"
