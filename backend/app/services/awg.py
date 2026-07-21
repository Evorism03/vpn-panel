"""AmneziaWG integration — commands, config parsing, client management."""
import base64
import hashlib
import ipaddress
import logging
import os
import re
import secrets
import shutil
import subprocess
import threading
import time
from datetime import date, timedelta
from typing import Optional

from fastapi import HTTPException

from ..config import get_settings

cfg = get_settings()
log = logging.getLogger(__name__)

# ── Single process-wide lock for AWG config file writes ───────────────────────
# All writers (create, delete, renew, expire) must hold this lock.
# Readers (list clients) do NOT need it — SQLite is the source of truth.
AWG_WRITE_LOCK = threading.RLock()

_resolved_bin: Optional[str] = None


# ── Binary resolution ──────────────────────────────────────────────────────────

def _resolve_bin() -> str:
    global _resolved_bin
    if _resolved_bin:
        return _resolved_bin
    if not cfg.awg_docker_container or cfg.awg_bin != "awg":
        _resolved_bin = cfg.awg_bin
        return _resolved_bin
    for candidate in ["awg", "/usr/bin/awg", "/usr/local/bin/awg"]:
        try:
            r = subprocess.run(
                ["docker", "exec", cfg.awg_docker_container, "sh", "-c", f"command -v {candidate}"],
                capture_output=True, text=True, timeout=3,
            )
            if r.returncode == 0 and r.stdout.strip():
                _resolved_bin = r.stdout.strip()
                return _resolved_bin
        except Exception:
            continue
    _resolved_bin = cfg.awg_bin
    return _resolved_bin


# ── AWG command execution ──────────────────────────────────────────────────────

def _mock_key() -> str:
    return base64.b64encode(secrets.token_bytes(32)).decode()


def awg(args: list[str], input_text: Optional[str] = None) -> str:
    if cfg.mock_awg:
        if args in [["genkey"], ["genpsk"]]:
            return _mock_key()
        if args == ["pubkey"]:
            return _mock_key()
        if args[:2] == ["show", cfg.awg_interface]:
            return "mock\t0\t0\t0"
        return ""
    bin_ = _resolve_bin()
    cmd = [bin_, *args]
    if cfg.awg_docker_container:
        cmd = ["docker", "exec", "-i", cfg.awg_docker_container, bin_, *args]
    try:
        return subprocess.check_output(cmd, input=input_text, stderr=subprocess.STDOUT, text=True).strip()
    except subprocess.CalledProcessError as e:
        raise HTTPException(500, e.output.strip() or str(e))
    except FileNotFoundError:
        raise HTTPException(500, f"Command not found: {cmd[0]}")


def awg_show_dump() -> str:
    try:
        return awg(["show", cfg.awg_interface, "dump"])
    except Exception:
        return ""


def remove_peer(public_key: str):
    if not public_key or cfg.mock_awg:
        return
    try:
        awg(["set", cfg.awg_interface, "peer", public_key, "remove"])
    except Exception:
        pass


# ── Config file I/O ────────────────────────────────────────────────────────────

def _ensure_mock_cfg():
    if not cfg.mock_awg or os.path.exists(cfg.awg_config_path):
        return
    os.makedirs(os.path.dirname(os.path.abspath(cfg.awg_config_path)), exist_ok=True)
    with open(cfg.awg_config_path, "w") as f:
        f.write("""[Interface]
PrivateKey = mock-server-private-key
Address = 10.8.1.1/24
ListenPort = 51820
Jc = 4
Jmin = 40
Jmax = 70
S1 = 0
S2 = 0
H1 = 1
H2 = 2
H3 = 3
H4 = 4
""")


def read_cfg() -> str:
    _ensure_mock_cfg()
    if cfg.awg_docker_container:
        return _docker_exec(["cat", cfg.awg_container_config_path])
    with open(cfg.awg_config_path, "r", encoding="utf-8") as f:
        return f.read()


def write_cfg(text: str):
    """Write AWG config. Caller MUST hold AWG_WRITE_LOCK."""
    if cfg.awg_docker_container:
        container_backup = f"{cfg.awg_container_config_path}.bak.{int(time.time())}"
        _docker_exec(["cp", cfg.awg_container_config_path, container_backup])
        _docker_exec(["sh", "-c", f"cat > {cfg.awg_container_config_path}"], text.rstrip() + "\n")
        return
    backup = f"{cfg.awg_config_path}.bak.{int(time.time())}"
    shutil.copy2(cfg.awg_config_path, backup)
    with open(cfg.awg_config_path, "w", encoding="utf-8") as f:
        f.write(text.rstrip() + "\n")


def _docker_exec(args: list[str], input_text: Optional[str] = None) -> str:
    try:
        return subprocess.check_output(
            ["docker", "exec", "-i", cfg.awg_docker_container, *args],
            input=input_text, stderr=subprocess.STDOUT, text=True,
        ).strip()
    except subprocess.CalledProcessError as e:
        raise HTTPException(500, e.output.strip() or str(e))
    except FileNotFoundError:
        raise HTTPException(500, "Command not found: docker")


# ── Config parsing ─────────────────────────────────────────────────────────────

def parse_interface(text: str) -> dict:
    m = re.search(r"\[Interface\](.*?)(?=\n\[Peer\]|\Z)", text, re.S)
    if not m:
        raise HTTPException(500, "No [Interface] section")
    data = {}
    for line in m.group(1).splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            data[k.strip()] = v.strip()
    return data


def parse_peers(text: str) -> list[dict]:
    peers = []
    for chunk in re.split(r"\n(?=\[Peer\])", text):
        if not chunk.strip().startswith("[Peer]"):
            continue
        data: dict = {}
        if m := re.search(r"#\s*Name:\s*(.+)", chunk):
            data["name"] = m.group(1).strip()
        if m := re.search(r"#\s*ID:\s*(.+)", chunk):
            data["client_id"] = m.group(1).strip()
        if m := re.search(r"#\s*Expires:\s*(.+)", chunk):
            data["expires_at"] = m.group(1).strip()
        if m := re.search(r"#\s*Created:\s*(.+)", chunk):
            data["created_at"] = m.group(1).strip()
        for line in chunk.splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                data[k.strip()] = v.strip()
        data["raw"] = chunk.strip()
        peers.append(data)
    return peers


# ── IP allocation ──────────────────────────────────────────────────────────────

def next_free_ip(interface_address: str, peers: list[dict]) -> str:
    cidr = interface_address.split(",")[0].strip()
    net = ipaddress.ip_network(cidr, strict=False)
    used = {str(ipaddress.ip_interface(cidr).ip)}
    for p in peers:
        for ip in p.get("AllowedIPs", "").split(","):
            ip = ip.strip()
            if ip:
                try:
                    used.add(str(ipaddress.ip_interface(ip).ip))
                except ValueError:
                    pass
    for host in net.hosts():
        if str(host) not in used:
            return str(host)
    raise HTTPException(500, "No free client IP addresses")


# ── Expiry helpers ─────────────────────────────────────────────────────────────

TERM_DAYS = {"3d": 3, "7d": 7, "14d": 14}
TERM_MONTHS = {"1m": 1, "3m": 3, "6m": 6, "1y": 12}
TERM_MAP = {
    "3 дня": "3d", "7 дней": "7d", "14 дней": "14d",
    "1 месяц": "1m", "3 месяца": "3m", "6 месяцев": "6m", "1 год": "1y",
    "1 month": "1m", "3 months": "3m", "6 months": "6m", "1 year": "1y",
    **{k: k for k in ["3d", "7d", "14d", "1m", "3m", "6m", "1y", "forever"]},
}


def normalize_term(term: str) -> str:
    return TERM_MAP.get(term.strip(), "1m")


def _add_months(d: date, months: int) -> date:
    mi = d.month - 1 + months
    year = d.year + mi // 12
    month = mi % 12 + 1
    days = [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28,
            31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return d.replace(year=year, month=month, day=min(d.day, days[month - 1]))


def expiration_date(term: str, base: Optional[str] = None) -> str:
    if term == "forever":
        return ""
    today = date.today()
    start = today
    if base:
        try:
            start = max(today, date.fromisoformat(base))
        except ValueError:
            pass
    if term in TERM_DAYS:
        return (start + timedelta(days=TERM_DAYS[term])).isoformat()
    if term in TERM_MONTHS:
        return _add_months(start, TERM_MONTHS[term]).isoformat()
    raise HTTPException(400, f"Unknown term: {term}")


def is_expired(expires_at: Optional[str]) -> bool:
    if not expires_at:
        return False
    try:
        return date.today() > date.fromisoformat(expires_at)
    except ValueError:
        return False


# ── Client config generation ───────────────────────────────────────────────────

def build_client_config(private_key: str, address: str, server_public: str,
                        psk: str, interface: dict) -> str:
    extra_keys = ["Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4",
                  "H1", "H2", "H3", "H4", "I1", "I2", "I3", "I4", "I5"]
    extra = "\n".join(f"{k} = {interface[k]}" for k in extra_keys if k in interface)
    return (
        f"[Interface]\n"
        f"PrivateKey = {private_key}\n"
        f"Address = {address}/32\n"
        f"MTU = {interface.get('MTU', '1280')}\n"
        f"DNS = {cfg.client_dns}\n"
        + (extra + "\n" if extra else "")
        + f"\n[Peer]\n"
        f"PublicKey = {server_public}\n"
        f"PresharedKey = {psk}\n"
        f"AllowedIPs = {cfg.client_allowed_ips}\n"
        f"Endpoint = {cfg.server_endpoint}\n"
        f"PersistentKeepalive = {cfg.client_persistent_keepalive}\n"
    )


# ── Async reload (non-blocking) ────────────────────────────────────────────────

_reload_lock = threading.Lock()


def _syncconf_text(text: str) -> str:
    interface = parse_interface(text)
    lines = ["[Interface]\nPrivateKey = " + interface.get("PrivateKey", "")]
    for peer in parse_peers(text):
        parts = ["[Peer]"]
        for k in ["PublicKey", "PresharedKey", "AllowedIPs", "Endpoint", "PersistentKeepalive"]:
            if v := peer.get(k, "").strip():
                parts.append(f"{k} = {v}")
        lines.append("\n".join(parts))
    return "\n\n".join(lines) + "\n"


def _do_reload():
    if cfg.mock_awg:
        return
    try:
        text = read_cfg()
        stripped = _syncconf_text(text)
        bin_ = _resolve_bin()
        cmd = (
            ["docker", "exec", "-i", cfg.awg_docker_container, bin_,
             "syncconf", cfg.awg_interface, "/dev/stdin"]
            if cfg.awg_docker_container
            else [bin_, "syncconf", cfg.awg_interface, "/dev/stdin"]
        )
        r = subprocess.run(cmd, input=stripped, text=True, capture_output=True, timeout=5)
        if r.returncode == 0:
            return
        log.error(
            "awg syncconf failed (exit %s) on interface %s: %s",
            r.returncode, cfg.awg_interface, (r.stdout or r.stderr or "").strip(),
        )
    except Exception:
        log.exception("awg syncconf reload raised an exception")


def reload_awg_async():
    """Fire-and-forget AWG reload. Returns immediately, reload runs in background thread."""
    def _bg():
        if not _reload_lock.acquire(blocking=False):
            return   # another reload is already running — it will pick up latest config
        try:
            _do_reload()
        finally:
            _reload_lock.release()

    threading.Thread(target=_bg, daemon=True).start()


# ── Config hash for SSE monitor ────────────────────────────────────────────────

def get_cfg_hash() -> str:
    try:
        if cfg.awg_docker_container:
            return ""
        with open(cfg.awg_config_path, "rb") as f:
            return hashlib.md5(f.read()).hexdigest()
    except Exception:
        return ""
