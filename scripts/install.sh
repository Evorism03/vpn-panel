#!/usr/bin/env bash
set -Eeuo pipefail

# ─── Colours ──────────────────────────────────────────────────────────────────
if [ -t 1 ] && [ "${NO_COLOR:-}" = "" ]; then
  R='\033[0m' B='\033[1m' D='\033[2m'
  GN='\033[0;32m' BGN='\033[1;32m'
  CY='\033[0;36m' BCY='\033[1;36m'
  YL='\033[1;33m' RE='\033[0;31m' BRE='\033[1;31m'
else
  R=''; B=''; D=''; GN=''; BGN=''; CY=''; BCY=''; YL=''; RE=''; BRE=''
fi

# ─── Defaults ─────────────────────────────────────────────────────────────────
APP_NAME="vpn-panel"
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

STEP_N=0
_SPIN_PID=''

# ─── Logging ──────────────────────────────────────────────────────────────────
log()      { printf "  ${BGN}▶${R}  ${B}%s${R}\n" "$*"; }
log_ok()   { printf "  ${BGN}✓${R}  %s\n" "$*"; }
log_dim()  { printf "  ${D}   %s${R}\n" "$*"; }
log_warn() { printf "  ${YL}⚠${R}  %s\n" "$*"; }

step() {
  STEP_N=$(( STEP_N + 1 ))
  printf "\n  ${BCY}${B}◈  Step %d  —  %s${R}\n" "$STEP_N" "$*"
  printf "  ${D}──────────────────────────────────────────────────${R}\n\n"
}

fail() {
  spin_stop 2>/dev/null || true
  printf "\n  ${BRE}${B}✗  ERROR:${R}  ${RE}%s${R}\n\n" "$*" >&2
  exit 1
}

# ─── Spinner ──────────────────────────────────────────────────────────────────
spin_start() {
  [ -t 1 ] || return 0
  local msg="${1:-}"
  ( local -a f=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏'); local n=0
    while true; do
      printf "\r  \033[36m%s\033[0m  %s  " "${f[$n]}" "$msg"
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
  printf "  ${BCY}╔════════════════════════════════════════════╗${R}\n"
  printf "  ${BCY}║${R}                                            ${BCY}║${R}\n"
  printf "  ${BCY}║${R}    ${B}◈  VPN Panel  ·  Installer${R}             ${BCY}║${R}\n"
  printf "  ${BCY}║${R}    ${D}AmneziaWG · Multi-admin · Lava${R}          ${BCY}║${R}\n"
  printf "  ${BCY}║${R}                                            ${BCY}║${R}\n"
  printf "  ${BCY}╚════════════════════════════════════════════╝${R}\n\n"
}

require_root() {
  [ "$(id -u)" -eq 0 ] || fail "Run as root: sudo bash scripts/install.sh"
}

have_cmd() { command -v "$1" >/dev/null 2>&1; }

# ─── Docker ───────────────────────────────────────────────────────────────────
install_docker_if_missing() {
  if have_cmd docker; then
    log_ok "Docker: $(docker --version 2>/dev/null | head -1)"
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
      && log_ok "Docker CE installed" && return
  fi
  apt-get install -y -qq docker.io && systemctl enable --now docker
  log_ok "Docker installed"
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
detect_awg_container() {
  [ -n "${AWG_DOCKER_CONTAINER:-}" ] && { printf '%s' "$AWG_DOCKER_CONTAINER"; return; }
  docker ps --format '{{.Names}}' | grep -E 'amnezia.*awg|^awg[0-9]*$|^awg[-_]' | grep -Ev '^vpn-panel' | head -1 || true
}

detect_udp_port() {
  [ -n "${AWG_PORT:-}" ] && { printf '%s' "$AWG_PORT"; return; }
  docker port "$1" 2>/dev/null | awk -F: '/udp/ {print $NF; exit}' || true
}

_valid_ipv4() { printf '%s' "$1" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; }

detect_public_ip() {
  [ -n "${SERVER_IP:-}" ] && { printf '%s' "$SERVER_IP"; return; }
  local ip=""
  for svc in "https://api.ipify.org" "https://ifconfig.me" "https://icanhazip.com"; do
    if have_cmd curl; then
      ip="$(curl -s --connect-timeout 4 --max-time 6 "$svc" 2>/dev/null | tr -d '[:space:]' || true)"
    elif have_cmd wget; then
      ip="$(wget -qO- --timeout=6 "$svc" 2>/dev/null | tr -d '[:space:]' || true)"
    fi
    _valid_ipv4 "$ip" && { printf '%s' "$ip"; return; }
  done
  ip="$(ip route get 1.1.1.1 2>/dev/null | awk '/src/{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1);exit}}')"
  _valid_ipv4 "$ip" || ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  printf '%s' "${ip:-127.0.0.1}"
}

detect_awg_config_path() {
  local container="$1" iface="${AWG_INTERFACE:-awg0}"
  [ -n "${AWG_CONTAINER_CONFIG_PATH:-}" ] && { printf '%s' "$AWG_CONTAINER_CONFIG_PATH"; return; }
  docker exec "$container" sh -c '
    for p in \
      "/opt/amnezia/awg/$1.conf" "/opt/amnezia/amneziawg/$1.conf" \
      "/etc/amnezia/amneziawg/$1.conf" "/etc/wireguard/$1.conf" \
      "/config/$1.conf" "/opt/amnezia/awg/awg0.conf" \
      "/etc/wireguard/awg0.conf" "/etc/wireguard/wg0.conf"; do
      [ -f "$p" ] && printf "%s" "$p" && exit 0
    done
    find /opt/amnezia /etc/amnezia /etc/wireguard /config \
      -maxdepth 4 -name "*.conf" 2>/dev/null | head -1
  ' sh "$iface" 2>/dev/null || true
}

iface_from_path() { basename "$1" .conf; }

gen_secret() {
  if have_cmd openssl; then
    openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
  else
    head -c 48 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=' | head -c 43
  fi
}

# ─── File copy ────────────────────────────────────────────────────────────────
copy_project() {
  step "Installing files → $INSTALL_DIR"
  mkdir -p "$INSTALL_DIR" "$BACKUP_DIR"
  if [ -d "$INSTALL_DIR/backend" ]; then
    local ts; ts="$(date +%Y%m%d-%H%M%S)"
    tar -czf "$BACKUP_DIR/vpn-panel-$ts.tar.gz" -C "$(dirname "$INSTALL_DIR")" "$(basename "$INSTALL_DIR")"
    log_dim "Backup → $BACKUP_DIR/vpn-panel-$ts.tar.gz"
  fi
  spin_start "Copying files…"
  tar --exclude='.git' --exclude='.env' --exclude='data' \
      --exclude='backend/.venv' --exclude='frontend/node_modules' \
      --exclude='frontend/dist' --exclude='**/__pycache__' \
      -C "$PROJECT_SRC" -czf /tmp/vpn-panel-install.tar.gz .
  tar -xzf /tmp/vpn-panel-install.tar.gz -C "$INSTALL_DIR"
  rm -f /tmp/vpn-panel-install.tar.gz
  spin_stop
  mkdir -p "$INSTALL_DIR/data"
  log_ok "Files installed"
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
    log "Keeping existing $env_path"
    # Patch missing keys after upgrade
    ensure_env_key "$env_path" "PRICE_1M"  "${PRICE_1M:-199}"
    ensure_env_key "$env_path" "PRICE_3M"  "${PRICE_3M:-499}"
    ensure_env_key "$env_path" "PRICE_6M"  "${PRICE_6M:-899}"
    ensure_env_key "$env_path" "PRICE_1Y"  "${PRICE_1Y:-1499}"
    ensure_env_key "$env_path" "PANEL_NAME" "${PANEL_NAME:-VPN Panel}"
    ensure_env_key "$env_path" "LAVA_API_KEY" ""
    ensure_env_key "$env_path" "LAVA_SHOP_ID" ""
    chmod 600 "$env_path"
    return
  fi

  step "Creating configuration"

  # ── Detect AWG ──────────────────────────────────────────────────────────────
  local awg_container; awg_container="$(detect_awg_container)"
  [ -n "$awg_container" ] || fail "AmneziaWG container not found. Run with AWG_DOCKER_CONTAINER=<name>."
  log_dim "AWG container → $awg_container"

  local awg_port; awg_port="$(detect_udp_port "$awg_container")"
  [ -n "$awg_port" ] || log_warn "Could not auto-detect AWG UDP port — update SERVER_ENDPOINT in .env"

  local server_ip; server_ip="$(detect_public_ip)"
  log_dim "Server IP → $server_ip"

  local awg_config_path; awg_config_path="$(detect_awg_config_path "$awg_container")"
  [ -n "$awg_config_path" ] || fail "AWG config not found in container '$awg_container'."
  log_dim "AWG config → $awg_config_path"

  local awg_iface; awg_iface="${AWG_INTERFACE:-$(iface_from_path "$awg_config_path")}"
  local server_endpoint="${SERVER_ENDPOINT:-}"
  [ -z "$server_endpoint" ] && [ -n "$awg_port" ] && server_endpoint="$server_ip:$awg_port"
  [ -n "$server_endpoint" ] || server_endpoint="$server_ip:"

  # ── Secrets ─────────────────────────────────────────────────────────────────
  local secret_key;       secret_key="$(gen_secret)"
  local admin_password;   admin_password="$(gen_secret | cut -c1-20)"

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
EOF
  chmod 600 "$env_path"
  log_ok "Config written → $env_path"
}

# ─── Start ────────────────────────────────────────────────────────────────────
start_containers() {
  local cmd="$1"
  step "Building & starting containers"
  cd "$INSTALL_DIR"
  docker network inspect "$NETWORK_NAME" >/dev/null 2>&1 \
    || docker network create "$NETWORK_NAME" >/dev/null
  docker rm -f "$FRONTEND_CONTAINER" "$BACKEND_CONTAINER" >/dev/null 2>&1 || true
  $cmd up -d --build backend frontend
}

start_manually() {
  step "Building & starting containers (manual)"
  docker network inspect "$NETWORK_NAME" >/dev/null 2>&1 \
    || docker network create "$NETWORK_NAME" >/dev/null
  docker rm -f "$FRONTEND_CONTAINER" "$BACKEND_CONTAINER" >/dev/null 2>&1 || true

  local _log; _log="$(mktemp)"

  spin_start "Building backend…"
  docker build -t vpn-panel-backend "$INSTALL_DIR/backend" >"$_log" 2>&1 || {
    spin_stop; cat "$_log" >&2; fail "Backend build failed"; }
  spin_stop; log_ok "Backend built"

  spin_start "Building frontend…"
  docker build -t vpn-panel-frontend "$INSTALL_DIR/frontend" >"$_log" 2>&1 || {
    spin_stop; cat "$_log" >&2; fail "Frontend build failed"; }
  spin_stop; rm -f "$_log"; log_ok "Frontend built"

  docker run -d --name "$BACKEND_CONTAINER" --restart unless-stopped \
    --network "$NETWORK_NAME" --network-alias backend \
    --env-file "$INSTALL_DIR/.env" \
    -v "$INSTALL_DIR/data:/data" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -p "$BACKEND_BIND:$BACKEND_PORT:8090" \
    vpn-panel-backend >/dev/null
  log_ok "Backend started"

  docker run -d --name "$FRONTEND_CONTAINER" --restart unless-stopped \
    --network "$NETWORK_NAME" \
    -p "$PANEL_HTTP_BIND:$PANEL_HTTP_PORT:80" \
    vpn-panel-frontend >/dev/null
  log_ok "Frontend started"
}

# ─── Healthcheck ──────────────────────────────────────────────────────────────
healthcheck() {
  step "Verifying installation"
  spin_start "Waiting for backend…"
  local attempt
  for attempt in $(seq 1 35); do
    if curl -fsS "http://127.0.0.1:$BACKEND_PORT/api/health" >/dev/null 2>&1 \
      || wget -q -O /dev/null "http://127.0.0.1:$BACKEND_PORT/api/health" 2>/dev/null; then
      spin_stop; log_ok "Backend is up"; break
    fi
    [ "$attempt" = "35" ] && {
      spin_stop
      docker logs --tail 40 "$BACKEND_CONTAINER" >&2 || true
      fail "Backend did not start in time"
    }
    sleep 1
  done

  spin_start "Checking frontend…"
  sleep 2
  if curl -fsSI "http://127.0.0.1:$PANEL_HTTP_PORT" >/dev/null 2>&1 \
    || wget -q --spider "http://127.0.0.1:$PANEL_HTTP_PORT" 2>/dev/null; then
    spin_stop; log_ok "Frontend is up"
  else
    spin_stop; log_warn "Frontend healthcheck failed — check docker logs $FRONTEND_CONTAINER"
  fi

  printf "\n"
  docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' \
    | grep -E "$BACKEND_CONTAINER|$FRONTEND_CONTAINER|NAMES" || true
}

# ─── Interactive wizard ───────────────────────────────────────────────────────
wizard() {
  [ -t 0 ] && [ "${INTERACTIVE:-1}" != "0" ] || return 0

  step "Configuration wizard"
  printf "  ${D}Press Enter to accept the default shown in [brackets].${R}\n\n"
  local _ans

  # Server IP
  local _ip; _ip="$(detect_public_ip)"
  printf "  ${B}Server public IP${R}   [${CY}%s${R}]: " "$_ip"
  read -r _ans; SERVER_IP="${_ans:-$_ip}"

  # Panel port
  printf "  ${B}Panel port (HTTP)${R}  [${CY}%s${R}]: " "$PANEL_HTTP_PORT"
  read -r _ans; PANEL_HTTP_PORT="${_ans:-$PANEL_HTTP_PORT}"

  # AWG container
  local _awg; _awg="$(detect_awg_container || true)"
  printf "  ${B}AmneziaWG container${R} [${CY}%s${R}]: " "${_awg:-amnezia-awg}"
  read -r _ans; AWG_DOCKER_CONTAINER="${_ans:-${_awg:-amnezia-awg}}"

  # AWG port
  local _wgp=""; [ -n "${AWG_DOCKER_CONTAINER:-}" ] && _wgp="$(detect_udp_port "$AWG_DOCKER_CONTAINER" || true)"
  printf "  ${B}AmneziaWG UDP port${R}  [${CY}%s${R}]: " "${_wgp:-?}"
  read -r _ans; AWG_PORT="${_ans:-$_wgp}"
  [ -n "$AWG_PORT" ] || log_warn "AWG port not set — update SERVER_ENDPOINT in .env later"

  # Admin credentials
  printf "  ${B}Admin username${R}      [${CY}admin${R}]: "
  read -r _ans; ADMIN_USERNAME="${_ans:-admin}"

  printf "  ${B}Admin password${R}      [${CY}auto-generated${R}]: "
  read -r -s _ans; printf "\n"
  [ -n "$_ans" ] && ADMIN_PASSWORD="$_ans"

  # Panel name
  printf "  ${B}Panel name${R}          [${CY}VPN Panel${R}]: "
  read -r _ans; PANEL_NAME="${_ans:-VPN Panel}"

  # Pricing
  printf "\n  ${B}Pricing (RUB)${R}\n"
  printf "  ${D}  0 = hide this plan from shop${R}\n\n"
  printf "  1 месяц   [${CY}199${R}]: "; read -r _ans; PRICE_1M="${_ans:-199}"
  printf "  3 месяца  [${CY}499${R}]: "; read -r _ans; PRICE_3M="${_ans:-499}"
  printf "  6 месяцев [${CY}899${R}]: "; read -r _ans; PRICE_6M="${_ans:-899}"
  printf "  1 год     [${CY}1499${R}]: "; read -r _ans; PRICE_1Y="${_ans:-1499}"

  # Lava
  printf "\n  ${B}Lava payments${R}  ${D}— auto-issue config after payment${R}\n"
  printf "  Lava API Key   [${CY}Enter to skip${R}]: "
  read -r _ans; LAVA_API_KEY="${_ans:-}"
  if [ -n "$LAVA_API_KEY" ]; then
    printf "  Lava Shop ID   [${CY}enter ID${R}]: "
    read -r _ans; LAVA_SHOP_ID="${_ans:-}"
    log_ok "Lava configured"
  else
    log_dim "Lava skipped — add LAVA_API_KEY/LAVA_SHOP_ID to .env later"
  fi

  printf "\n"
}

# ─── Action selector ──────────────────────────────────────────────────────────
select_action() {
  [ -d "$INSTALL_DIR/backend" ] || { ACTION_MODE="install"; return; }
  [ -t 0 ] && [ "${INTERACTIVE:-1}" != "0" ] || { ACTION_MODE="${ACTION_MODE:-update}"; return; }

  printf "\n  ${B}Panel already installed at ${CY}%s${R}\n\n" "$INSTALL_DIR"
  printf "  ${CY}1${R}  Update         ${D}— rebuild containers, keep data & .env${R}\n"
  printf "  ${CY}2${R}  Reinstall      ${D}— reset .env via wizard, keep client data${R}\n"
  printf "  ${CY}3${R}  Full reinstall ${D}— wipe everything, start fresh${R}\n"
  printf "  ${CY}0${R}  Exit\n"
  printf "\n  ${B}Choice${R} [${CY}1${R}]: "
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
    tar -czf "$BACKUP_DIR/vpn-panel-data-$ts.tar.gz" -C "$INSTALL_DIR" data 2>/dev/null || true
    rm -rf "$INSTALL_DIR/data"
    log_dim "Data backed up → $BACKUP_DIR/vpn-panel-data-$ts.tar.gz"
  }
  rm -f "$INSTALL_DIR/.env"
  log_ok "Wiped"
}

# ─── Summary ──────────────────────────────────────────────────────────────────
print_summary() {
  local username; username="$(env_value ADMIN_USERNAME)"
  local password; password="$(env_value ADMIN_PASSWORD)"
  local endpoint; endpoint="$(env_value SERVER_ENDPOINT)"
  local awg_cont; awg_cont="$(env_value AWG_DOCKER_CONTAINER)"
  local panel_name; panel_name="$(env_value PANEL_NAME)"
  local server_ip; server_ip="$(detect_public_ip)"
  local panel_url="http://$server_ip:$PANEL_HTTP_PORT"
  local S="══════════════════════════════════════════════════"

  printf "\n"
  printf "  ${BCY}╔%s${R}\n" "$S"
  printf "  ${BCY}║${R}  ${BGN}✓${R}  ${B}VPN Panel — Installation Complete${R}\n"
  printf "  ${BCY}╠%s${R}\n" "$S"
  printf "  ${BCY}║${R}  ${D}%-16s${R}  ${B}%s${R}\n"  "Panel URL"  "$panel_url"
  printf "  ${BCY}║${R}  ${D}%-16s${R}  ${B}%s${R}\n"  "Admin"      "$panel_url/admin"
  printf "  ${BCY}║${R}  ${D}%-16s${R}  ${B}%s${R}\n"  "Shop"       "$panel_url/"
  printf "  ${BCY}║${R}  ${D}%-16s${R}  ${B}%s${R}\n"  "Cabinet"    "$panel_url/cabinet"
  printf "  ${BCY}╠%s${R}\n" "$S"
  printf "  ${BCY}║${R}  ${D}%-16s${R}  %s\n"  "Username"   "${username:-admin}"
  printf "  ${BCY}║${R}  ${D}%-16s${R}  ${YL}%s${R}\n" "Password"   "$password"
  printf "  ${BCY}╠%s${R}\n" "$S"
  printf "  ${BCY}║${R}  ${D}%-16s${R}  %s\n"  "AWG Endpoint" "$endpoint"
  printf "  ${BCY}║${R}  ${D}%-16s${R}  %s\n"  "AWG Container" "$awg_cont"
  printf "  ${BCY}╚%s${R}\n" "$S"
  printf "\n"
  printf "  ${D}Manage .env: nano %s/.env${R}\n" "$INSTALL_DIR"
  printf "  ${D}Logs:  docker logs -f %s${R}\n\n" "$BACKEND_CONTAINER"
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
  banner
  require_root
  install_docker_if_missing
  select_action

  case "$ACTION_MODE" in
    full_reinstall) wipe_data; wizard ;;
    reinstall)      rm -f "$INSTALL_DIR/.env"; wizard ;;
    update)         ;;  # keep .env, just rebuild
    *)              wizard ;;
  esac

  check_ports
  copy_project
  write_env

  local cmd; cmd="$(compose_cmd)"
  if [ -n "$cmd" ]; then
    start_containers "$cmd"
  else
    start_manually
  fi

  healthcheck
  print_summary
}

main "$@"
