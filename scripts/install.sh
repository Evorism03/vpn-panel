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

# Only used by the no-docker-compose fallback (start_manually) — the normal
# compose path is served entirely through Caddy on 80/443, see Caddyfile.
PANEL_HTTP_PORT="${PANEL_HTTP_PORT:-8080}"
PANEL_HTTP_BIND="${PANEL_HTTP_BIND:-0.0.0.0}"
BACKEND_PORT="${BACKEND_PORT:-8090}"
BACKEND_BIND="${BACKEND_BIND:-127.0.0.1}"
NETWORK_NAME="${NETWORK_NAME:-vpn-panel-net}"

BACKEND_CONTAINER="${BACKEND_CONTAINER:-vpn-panel-backend}"
FRONTEND_CONTAINER="${FRONTEND_CONTAINER:-vpn-panel-frontend}"
CADDY_CONTAINER="${CADDY_CONTAINER:-vpn-panel-caddy}"
DOMAIN="${DOMAIN:-}"

SKIP_DOCKER_INSTALL="${SKIP_DOCKER_INSTALL:-0}"
FORCE_PORT="${FORCE_PORT:-0}"
ACTION_MODE="${ACTION_MODE:-}"
INSTALL_MODE="${INSTALL_MODE:-}"   # panel | agent

# --verbose / -v (or VERBOSE=1) — show every command's real output live
# instead of the spinner, for debugging a step that fails without saying why.
VERBOSE="${VERBOSE:-0}"
SHOW_HELP=0
for _arg in "$@"; do
  case "$_arg" in
    --verbose|-v) VERBOSE=1 ;;
    --help|-h)    SHOW_HELP=1 ;;
  esac
done

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

print_help() {
  banner
  printf "  ${B}Использование${R}\n"
  printf "    sudo bash scripts/install.sh [флаги]\n\n"
  printf "  ${B}Флаги${R}\n"
  printf "    ${CY}%-22s${R} %s\n" "-v, --verbose" "Полный вывод команд вместо спиннера"
  printf "    ${CY}%-22s${R} %s\n" "-h, --help"    "Показать эту справку и выйти"
  printf "\n"
  printf "  ${B}Частые переменные окружения${R}  ${DIM}(VAR=значение sudo bash scripts/install.sh)${R}\n"
  printf "    ${CY}%-22s${R} %s\n" "INSTALL_MODE"        "panel | agent — режим установки без вопроса в визарде"
  printf "    ${CY}%-22s${R} %s\n" "DOMAIN"              "Домен для авто-HTTPS через Caddy (по умолчанию — только IP)"
  printf "    ${CY}%-22s${R} %s\n" "AWG_AUTO_INSTALL"    "yes | no — ставить ли AmneziaWG автоматически"
  printf "    ${CY}%-22s${R} %s\n" "AWG_UDP_PORT"        "UDP-порт AmneziaWG (по умолчанию 51820)"
  printf "    ${CY}%-22s${R} %s\n" "AWG_DOCKER_CONTAINER" "Имя уже существующего AWG-контейнера, если он есть"
  printf "    ${CY}%-22s${R} %s\n" "INSTALL_DIR"         "Куда ставить панель (по умолчанию /opt/vpn-panel)"
  printf "    ${CY}%-22s${R} %s\n" "INTERACTIVE"         "0 — не задавать вопросы, использовать только defaults/env"
  printf "    ${CY}%-22s${R} %s\n" "FORCE_PORT"          "1 — не проверять занятость портов 80/443"
  printf "    ${CY}%-22s${R} %s\n" "SKIP_DOCKER_INSTALL" "1 — не пытаться ставить Docker автоматически"
  printf "\n"
  printf "  ${DIM}Полный список переменных — в начале файла scripts/install.sh (секция Defaults).${R}\n\n"
}

require_root() {
  [ "$(id -u)" -eq 0 ] || fail "Run as root: sudo bash scripts/install.sh"
}

have_cmd() { command -v "$1" >/dev/null 2>&1; }

# Run a command: with VERBOSE=1 / --verbose, print the description and let
# the command's real stdout/stderr go straight to the terminal. Otherwise
# (default) run it behind the spinner and only dump its output if it fails.
# Exit code is always propagated — use as `run_step "..." cmd ... || fail ...`.
run_step() {
  local desc="$1"; shift
  if [ "$VERBOSE" = "1" ]; then
    log_info "$desc"
    if "$@"; then return 0; else return 1; fi
  fi
  local _rs_log; _rs_log="$(mktemp)"
  spin_start "$desc…"
  if "$@" >"$_rs_log" 2>&1; then
    spin_stop; rm -f "$_rs_log"; return 0
  fi
  spin_stop
  log_warn "$desc — ошибка, вывод:"
  cat "$_rs_log" >&2
  rm -f "$_rs_log"
  return 1
}

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

# Docker itself being present doesn't mean the `docker compose` plugin is —
# e.g. it's missing on plain `docker.io` installs, or on any pre-existing
# Docker setup that predates the plugin. Without it, the installer silently
# falls back to start_manually() further down, which has no Caddy/HTTPS/domain
# support at all. Make sure compose actually works instead of discovering
# this the hard way after a "successful" install.
ensure_compose() {
  docker compose version >/dev/null 2>&1 && {
    log "Docker Compose $(docker compose version --short 2>/dev/null || echo v2)"
    return
  }
  have_cmd docker-compose && { log_dim "Using standalone docker-compose (v1)"; return; }

  [ "$SKIP_DOCKER_INSTALL" = "1" ] && { log_warn "docker compose not found — Caddy/HTTPS won't be set up (legacy mode)"; return; }

  # Try apt first (fast, but only works if the Docker CE apt repo is set up —
  # plain distro `docker.io` installs usually don't have this package).
  if have_cmd apt-get; then
    step "Installing Docker Compose plugin (apt)"
    local apt_log; apt_log="$(mktemp)"
    if apt-get update -qq >"$apt_log" 2>&1 && apt-get install -y -qq docker-compose-plugin >>"$apt_log" 2>&1; then
      rm -f "$apt_log"
    else
      log_warn "apt install failed, falling back to the official binary"
      log_dim "$(tail -3 "$apt_log")"
      rm -f "$apt_log"
    fi
    docker compose version >/dev/null 2>&1 && {
      log "Docker Compose $(docker compose version --short 2>/dev/null || echo v2)"
      return
    }
  fi

  # Fall back to Docker's own binary release — works regardless of which apt
  # repos are configured, as long as we can reach GitHub.
  step "Installing Docker Compose (official binary)"
  local plugin_dir="/usr/local/lib/docker/cli-plugins"
  local arch; arch="$(uname -m)"
  local url="https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${arch}"
  mkdir -p "$plugin_dir"
  local dl_log; dl_log="$(mktemp)"
  if curl -fsSL "$url" -o "$plugin_dir/docker-compose" 2>"$dl_log"; then
    chmod +x "$plugin_dir/docker-compose"
  else
    log_warn "Download failed:"
    log_dim "$(tail -3 "$dl_log")"
  fi
  rm -f "$dl_log"

  if docker compose version >/dev/null 2>&1; then
    log "Docker Compose $(docker compose version --short 2>/dev/null || echo v2)"
  else
    log_warn "Could not set up docker compose — Caddy/HTTPS won't be configured (legacy mode)."
    log_warn "Install it manually and re-run:"
    log_dim "sudo mkdir -p $plugin_dir"
    log_dim "sudo curl -SL \"$url\" -o $plugin_dir/docker-compose"
    log_dim "sudo chmod +x $plugin_dir/docker-compose"
  fi
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
  # Caddy is the only thing published to the host now (80 + 443).
  for p in 80 443; do
    if port_busy "$p"; then
      local owner; owner="$(docker ps --filter "publish=$p" --format '{{.Names}}' 2>/dev/null | head -1 || true)"
      [ "$owner" = "$CADDY_CONTAINER" ] || fail "Port $p busy. Free it, or set FORCE_PORT=1 to ignore."
    fi
  done
}

# ─── Detection ────────────────────────────────────────────────────────────────
_valid_ipv4() { printf '%s' "$1" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; }

# Reject a domain containing non-ASCII characters — e.g. a Cyrillic
# lookalike letter typed by accident with the wrong keyboard layout looks
# identical in a terminal but is a completely different (non-existent)
# domain. Caddy would silently try (and keep retrying) to get a Let's
# Encrypt cert for that punycode domain forever, burning ACME rate-limit
# attempts, while the site itself never gets a working certificate.
# Empty is valid — domain/HTTPS is optional (plain IP still works).
_valid_ascii_domain() {
  [ -z "$1" ] && return 0
  printf '%s' "$1" | LC_ALL=C grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$'
}

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

  # Backstop for non-interactive runs (DOMAIN passed as an env var, wizard
  # skipped) — the wizard itself already validates when run interactively.
  if ! _valid_ascii_domain "${DOMAIN:-}"; then
    log_warn "DOMAIN='${DOMAIN:-}' has non-ASCII characters — ignoring it, HTTPS won't be configured"
    DOMAIN=""
  fi

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
    ensure_env_key "$env_path" "DOMAIN"        "${DOMAIN:-}"
    ensure_env_key "$env_path" "AGENT_TOKEN"   "$(gen_secret)"
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
  local agent_token;    agent_token="$(gen_secret)"

  # Caddy serves the panel on 80/443 now — HTTPS via the domain if set,
  # otherwise plain HTTP by IP (see Caddyfile).
  local default_panel_url
  if [ -n "${DOMAIN:-}" ]; then default_panel_url="https://$DOMAIN"
  else default_panel_url="http://$server_ip"; fi

  cat > "$env_path" <<EOF
# ── Auth ──────────────────────────────────────────────────────────────────────
SECRET_KEY=$secret_key
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=30
ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
ADMIN_PASSWORD=$admin_password
AGENT_TOKEN=$agent_token

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
LAVA_SUCCESS_URL=${LAVA_SUCCESS_URL:-$default_panel_url/cabinet}
LAVA_FAIL_URL=${LAVA_FAIL_URL:-$default_panel_url}

# ── Pricing (RUB) ─────────────────────────────────────────────────────────────
PRICE_1M=${PRICE_1M:-199}
PRICE_3M=${PRICE_3M:-499}
PRICE_6M=${PRICE_6M:-899}
PRICE_1Y=${PRICE_1Y:-1499}

# ── Branding ──────────────────────────────────────────────────────────────────
PANEL_NAME=${PANEL_NAME:-VPN Panel}
PANEL_DOMAIN=${PANEL_DOMAIN:-${DOMAIN:-}}

# ── Domain / HTTPS (Caddy) ────────────────────────────────────────────────────
DOMAIN=${DOMAIN:-}

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
  docker rm -f "$FRONTEND_CONTAINER" "$BACKEND_CONTAINER" "$CADDY_CONTAINER" >/dev/null 2>&1 || true
  spin_start "Building images…"
  $cmd up -d --build backend frontend caddy >/dev/null 2>&1
  spin_stop
  log "Containers started"
}

# Fallback for hosts without `docker compose`. No Caddy/domain/HTTPS here —
# frontend is published directly on PANEL_HTTP_PORT, same as before.
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
# One check through Caddy on :80 → frontend → backend proxy chain — if this
# passes, all three are up and wired together correctly. No per-service port
# checks needed anymore since only Caddy is published to the host.
healthcheck() {
  step "Health check"
  spin_start "Waiting for panel…"
  local attempt=0 delay="0.3" elapsed="0"
  while true; do
    attempt=$(( attempt + 1 ))
    if curl -fsS "http://127.0.0.1/api/health" >/dev/null 2>&1 \
      || wget -q -O /dev/null "http://127.0.0.1/api/health" 2>/dev/null; then
      spin_stop; log "Panel  ${BGN}online${R}  ${DIM}(~${elapsed}s)${R}"; break
    fi
    [ "$attempt" -ge 50 ] && {
      spin_stop
      docker logs --tail 40 "$BACKEND_CONTAINER" >&2 || true
      docker logs --tail 20 "$CADDY_CONTAINER" >&2 || true
      fail "Panel did not start in time"
    }
    sleep "$delay"
    elapsed="$(awk "BEGIN{printf \"%.0f\", $elapsed + $delay}")"
    # Exponential backoff: 0.3 → 0.4 → 0.6 → … → max 2.0s
    delay="$(awk "BEGIN{d=$delay*1.4; print (d>2)?2:d}")"
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
  while :; do
    _prompt "Домен (Enter — пропустить, только IP)" "${DOMAIN}"; DOMAIN="$_ANS"
    _valid_ascii_domain "$DOMAIN" && break
    printf "  ${DIM}│${R}  ${BRE}✗${R}  ${RE}Домен должен быть латиницей (a-z, 0-9, -, .) — проверь раскладку клавиатуры${R}\n"
  done

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
  [ "$VERBOSE" = "1" ] && log_dim "Подробный режим: весь вывод команд ниже без скрытия"

  local cfg_dir="$AWG_CONFIG_DIR"
  mkdir -p "$cfg_dir"

  run_step "Загружаем образ amneziavpn/amneziawg" docker pull amneziavpn/amneziawg \
    || fail "Не удалось скачать образ amneziavpn/amneziawg — см. вывод выше (сеть? Docker Hub недоступен?)."
  log "Образ загружен"

  # One throwaway container generates both keys (genkey piped straight into
  # pubkey inside it) instead of spinning up two separate containers for two
  # near-instant commands — output IS the data we need, so it's always
  # captured; VERBOSE only changes whether stderr streams live or gets
  # captured and shown solely on failure.
  local _awg_log _keys priv_key pub_key
  local _gen_cmd='p=$(awg genkey) && k=$(printf "%s" "$p" | awg pubkey) && printf "%s\n%s" "$p" "$k"'
  if [ "$VERBOSE" = "1" ]; then
    log_info "Генерируем ключи сервера…"
    _keys="$(docker run --rm amneziavpn/amneziawg sh -c "$_gen_cmd")"
  else
    _awg_log="$(mktemp)"
    spin_start "Генерируем ключи сервера…"
    _keys="$(docker run --rm amneziavpn/amneziawg sh -c "$_gen_cmd" 2>"$_awg_log")"
    spin_stop
  fi
  priv_key="$(printf '%s\n' "$_keys" | sed -n '1p')"
  pub_key="$(printf '%s\n' "$_keys" | sed -n '2p')"
  if [ -z "$priv_key" ] || [ -z "$pub_key" ]; then
    if [ "$VERBOSE" != "1" ]; then cat "$_awg_log" >&2; rm -f "$_awg_log"; fi
    fail "Не удалось сгенерировать ключи сервера (awg genkey/pubkey) — см. вывод выше."
  fi
  [ "$VERBOSE" = "1" ] || { rm -f "$_awg_log"; log "Ключи сгенерированы"; }

  # Random AmneziaWG 2.0 obfuscation params (Jc/Jmin/Jmax junk packets before
  # handshake, S1-S4 padding of handshake/cookie messages, H1-H4 packet magic
  # headers). Fresh install, so client configs are generated to match — see
  # build_client_config() in backend/app/services/awg.py, which already
  # forwards S3/S4 to clients whenever present in this file.
  # I1-I5 (protocol-mimicry junk packets, e.g. fake QUIC Initial) are
  # intentionally NOT auto-generated here: they're free-form packet content,
  # not random numbers, and a wrong/malformed value can break the handshake
  # entirely. Add them manually later if you want that extra layer — see
  # https://docs.amnezia.org/documentation/instructions/new-amneziawg-selfhosted/
  rand_int() { shuf -i "${1}-${2}" -n 1 2>/dev/null || awk -v a="$1" -v b="$2" 'BEGIN{srand();print int(a+rand()*(b-a+1))}'; }
  local Jc Jmin Jmax S1 S2 S3 S4 H1 H2 H3 H4
  Jc="$(rand_int 3 10)"
  Jmin="$(rand_int 50 150)"
  Jmax="$(rand_int 200 900)"
  S1="$(rand_int 15 50)"
  S2="$(rand_int 15 50)"
  S3="$(rand_int 15 50)"
  S4="$(rand_int 15 50)"
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
S3 = $S3
S4 = $S4
H1 = $H1
H2 = $H2
H3 = $H3
H4 = $H4
EOF
  chmod 600 "$cfg_dir/awg0.conf"
  log "Конфиг создан (AmneziaWG 2.0: Jc/Jmin/Jmax, S1-S4, H1-H4)  ${DIM}→ $cfg_dir/awg0.conf${R}"

  # Stop old container if exists
  docker rm -f "$AWG_CONTAINER_NAME" >/dev/null 2>&1 || true

  run_step "Запускаем контейнер $AWG_CONTAINER_NAME" docker run -d \
    --name "$AWG_CONTAINER_NAME" \
    --restart unless-stopped \
    --cap-add NET_ADMIN \
    --cap-add SYS_MODULE \
    --sysctl net.ipv4.ip_forward=1 \
    --device /dev/net/tun \
    -v "$cfg_dir:/opt/amnezia/awg" \
    -p "$AWG_UDP_PORT:$AWG_UDP_PORT/udp" \
    amneziavpn/amneziawg \
    || fail "Не удалось запустить контейнер $AWG_CONTAINER_NAME — см. вывод выше (порт занят? имя конфликтует?)."

  # Give the entrypoint a moment to bring the interface up, then verify it
  # actually applied S3/S4 — an image too old to parse AmneziaWG 2.0 fields
  # would otherwise fail silently here and leave a container that's "running"
  # but never actually raised awg0, which is much harder to debug later.
  sleep 2
  if ! docker ps --format '{{.Names}}' | grep -qx "$AWG_CONTAINER_NAME"; then
    log_warn "Контейнер $AWG_CONTAINER_NAME не запустился, логи:"
    docker logs --tail 30 "$AWG_CONTAINER_NAME" >&2 2>&1 || true
    fail "AmneziaWG контейнер упал сразу после запуска — образ amneziavpn/amneziawg возможно не поддерживает поля S3/S4 (AWG 2.0). Проверьте логи выше."
  fi
  local iface_check="${AWG_INTERFACE:-awg0}"
  if ! docker exec "$AWG_CONTAINER_NAME" awg show "$iface_check" >/dev/null 2>&1; then
    log_warn "Интерфейс $iface_check не поднялся внутри контейнера — вероятно, установленная версия awg-tools не поддерживает S3/S4."
    log_warn "Логи контейнера:"
    docker logs --tail 30 "$AWG_CONTAINER_NAME" >&2 2>&1 || true
    log_warn "Можно убрать строки S3/S4 из $cfg_dir/awg0.conf и перезапустить: docker restart $AWG_CONTAINER_NAME"
  else
    log "Контейнер запущен  ${DIM}→ $AWG_CONTAINER_NAME:$AWG_UDP_PORT/udp${R}"
  fi

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

# The panel's SQLite DB (data/vpn.db) and the AmneziaWG server's live peer
# list are two entirely separate things — wiping the DB alone does NOT
# disconnect anyone. Their WireGuard configs stay valid, active peers on the
# real server forever, invisible to the panel. "Full reinstall" means
# genuinely fresh, so clear the live peers too.
wipe_awg_peers() {
  local awg_container="$_DETECTED_AWG_CONTAINER"
  local awg_config="$_DETECTED_AWG_CONFIG"
  [ -n "$awg_container" ] && [ -n "$awg_config" ] || return 0

  step "Removing all WireGuard peers from $awg_container"
  local iface; iface="$(basename "$awg_config" .conf)"
  local ts; ts="$(date +%Y%m%d-%H%M%S)"

  docker cp "$awg_container:$awg_config" "$BACKUP_DIR/awg0-$ts.conf" 2>/dev/null || true

  # Keep [Interface], drop every [Peer] block
  if ! docker exec "$awg_container" sh -c "
    awk '/^\[Peer\]/{exit} {print}' '$awg_config' > '${awg_config}.tmp' \
      && mv '${awg_config}.tmp' '$awg_config'
  " >/dev/null 2>&1; then
    log_warn "Could not strip peers from $awg_config"
    return
  fi

  local bin=""
  for candidate in awg wg /usr/bin/awg /usr/bin/wg /usr/local/bin/awg; do
    docker exec "$awg_container" sh -c "command -v $candidate" >/dev/null 2>&1 && { bin="$candidate"; break; }
  done
  if [ -z "$bin" ]; then
    log_warn "No awg/wg binary found in $awg_container — config cleared but kernel state not synced yet (will apply after container restart)"
    return
  fi

  if docker exec -i "$awg_container" "$bin" syncconf "$iface" "$awg_config" >/dev/null 2>&1; then
    log "All WireGuard peers removed  ${DIM}(backup → $BACKUP_DIR/awg0-$ts.conf)${R}"
  else
    log_warn "syncconf failed — peers may stay active until $awg_container restarts"
  fi
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
  wipe_awg_peers
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
  local domain;     domain="$(env_value DOMAIN)"
  local panel_url
  if [ -n "$domain" ]; then panel_url="https://$domain"
  else panel_url="http://$server_ip"; fi

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
    ensure_env_key "$env_path" "AGENT_TOKEN" "$(gen_secret)"
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
  local agent_token; agent_token="$(gen_secret)"

  cat > "$env_path" <<EOF
# ── Auth ──────────────────────────────────────────────────────────────────────
SECRET_KEY=$secret_key
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=30
ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
ADMIN_PASSWORD=$admin_password

# Static token the main panel uses to authenticate to this agent (paste into
# Servers → Add server → Token). Unlike an admin JWT it never expires.
AGENT_TOKEN=$agent_token

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
  local token;      token="$(env_value AGENT_TOKEN)"
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
  ensure_compose

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

if [ "$SHOW_HELP" = "1" ]; then
  print_help
  exit 0
fi

main "$@"
