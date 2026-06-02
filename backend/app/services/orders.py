"""Order processing: create clients, renew subscriptions."""
import re
import secrets
from datetime import date, datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import Client, Order
from .. import broadcast as _bc
from .awg import (
    AWG_WRITE_LOCK,
    awg, build_client_config, expiration_date, is_expired,
    next_free_ip, normalize_term, parse_interface, parse_peers,
    read_cfg, reload_awg_async, write_cfg,
)

cfg = get_settings()


# ── Client creation ────────────────────────────────────────────────────────────

def create_client(db: Session, name: str, term: str, contact: str = "",
                  expires_at: Optional[str] = None) -> dict:
    term = normalize_term(term)

    # Generate keys first (outside lock — awg genkey is slow in real mode)
    private_key = awg(["genkey"])
    public_key  = awg(["pubkey"], input_text=private_key)
    psk         = awg(["genpsk"])
    client_id   = secrets.token_hex(4)
    created_at  = date.today().isoformat()

    if expires_at is None:
        expires_at = expiration_date(term) if term != "forever" else ""

    with AWG_WRITE_LOCK:
        text      = read_cfg()
        interface = parse_interface(text)
        peers     = parse_peers(text)
        ip        = next_free_ip(interface.get("Address", "10.8.1.1/24"), peers)

        expires_line = f"# Expires: {expires_at}\n" if expires_at else ""
        peer_block = (
            f"\n\n[Peer]\n"
            f"# Name: {name}\n"
            f"# ID: {client_id}\n"
            f"# Created: {created_at}\n"
            f"{expires_line}"
            f"PublicKey = {public_key}\n"
            f"PresharedKey = {psk}\n"
            f"AllowedIPs = {ip}/32\n"
        )
        write_cfg(text.rstrip() + peer_block)

    reload_awg_async()

    server_public = awg(["pubkey"], input_text=interface["PrivateKey"])
    config_text = (
        f"# Client ID: {client_id}\n"
        + build_client_config(private_key, ip, server_public, psk, interface)
    )

    db_client = Client(
        id=client_id, name=name, public_key=public_key,
        contact=contact.strip(), server_id="local",
        status="active", expires_at=expires_at or None,
        created_at=created_at, config_text=config_text,
    )
    db.add(db_client)
    db.commit()
    db.refresh(db_client)
    _bc.push("clients")

    return {
        "id": client_id, "name": name, "public_key": public_key,
        "contact": contact, "address": f"{ip}/32",
        "expires_at": expires_at, "created_at": created_at,
        "config": config_text, "status": "active",
    }


# ── Delete client from AWG config ─────────────────────────────────────────────

def delete_client_from_cfg(public_key: str):
    """Remove a peer block from awg config. Caller should NOT hold AWG_WRITE_LOCK."""
    with AWG_WRITE_LOCK:
        text = read_cfg()
        new_chunks = []
        for chunk in re.split(r"\n(?=\[Peer\])", text):
            if chunk.strip().startswith("[Peer]"):
                peers = parse_peers(chunk)
                if peers and peers[0].get("PublicKey", "").strip() == public_key:
                    continue
            new_chunks.append(chunk)
        write_cfg("\n".join(new_chunks))
    reload_awg_async()


# ── Expiry enforcement ─────────────────────────────────────────────────────────

def enforce_expired(db: Session):
    changed = False
    expired_keys: list[str] = []

    with AWG_WRITE_LOCK:
        text   = read_cfg()
        chunks = re.split(r"\n(?=\[Peer\])", text)
        kept   = []

        for chunk in chunks:
            if not chunk.strip().startswith("[Peer]"):
                kept.append(chunk)
                continue
            peer = parse_peers(chunk)
            if not peer:
                kept.append(chunk)
                continue
            p  = peer[0]
            pk = p.get("PublicKey", "").strip()
            if pk and is_expired(p.get("expires_at")):
                expired_keys.append(pk)
                changed = True
                continue
            kept.append(chunk)

        if changed:
            write_cfg("\n".join(kept))

    if changed:
        reload_awg_async()
        today = date.today().isoformat()
        for pk in expired_keys:
            c = db.query(Client).filter(Client.public_key == pk).first()
            if c and c.status == "active":
                c.status     = "expired"
                c.blocked_at = today
        db.commit()
        _bc.push("clients")


# ── Renewal ────────────────────────────────────────────────────────────────────

def renew_client(db: Session, client_id: str, term: str) -> dict:
    term   = normalize_term(term)
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(404, "Client not found")

    new_expiry = expiration_date(term, client.expires_at) if term != "forever" else ""

    if client.status == "expired":
        _restore_expired_client(client, new_expiry)
        client.status     = "active"
        client.blocked_at = None
    else:
        _update_expiry_in_cfg(client.public_key, new_expiry)

    client.expires_at = new_expiry or None
    db.commit()
    return {"id": client_id, "expires_at": new_expiry, "status": client.status}


def _restore_expired_client(client: Client, new_expiry: str):
    if not client.config_text:
        raise HTTPException(400, "No stored config, cannot restore expired client")
    psk_m = re.search(r"PresharedKey\s*=\s*(.+)", client.config_text or "")
    psk   = psk_m.group(1).strip() if psk_m else awg(["genpsk"])
    ip    = _ip_from_config(client.config_text)
    expires_line = f"# Expires: {new_expiry}\n" if new_expiry else ""
    peer_block = (
        f"\n\n[Peer]\n"
        f"# Name: {client.name}\n"
        f"# ID: {client.id}\n"
        f"# Created: {client.created_at}\n"
        f"{expires_line}"
        f"PublicKey = {client.public_key}\n"
        f"PresharedKey = {psk}\n"
        f"AllowedIPs = {ip}/32\n"
    )
    with AWG_WRITE_LOCK:
        write_cfg(read_cfg().rstrip() + peer_block)
    reload_awg_async()


def _update_expiry_in_cfg(public_key: str, new_expiry: str):
    with AWG_WRITE_LOCK:
        text   = read_cfg()
        chunks = re.split(r"\n(?=\[Peer\])", text)
        result = []
        for chunk in chunks:
            if chunk.strip().startswith("[Peer]"):
                peers = parse_peers(chunk)
                if peers and peers[0].get("PublicKey", "").strip() == public_key:
                    if re.search(r"(?m)^#\s*Expires:", chunk):
                        if new_expiry:
                            chunk = re.sub(r"(?m)^#\s*Expires:.*$",
                                           f"# Expires: {new_expiry}", chunk, count=1)
                        else:
                            chunk = re.sub(r"(?m)^#\s*Expires:.*\n?", "", chunk)
                    elif new_expiry:
                        chunk = re.sub(r"(?m)^(PublicKey\s*=)",
                                       f"# Expires: {new_expiry}\n\\1", chunk, count=1)
            result.append(chunk)
        write_cfg("\n".join(result))
    reload_awg_async()


def _ip_from_config(config_text: str) -> str:
    m = re.search(r"Address\s*=\s*([0-9.]+)", config_text)
    return m.group(1) if m else "10.8.1.2"


# ── Order processing ───────────────────────────────────────────────────────────

def process_order(db: Session, order: Order) -> Order:
    term = normalize_term(order.term)

    if order.client_id:
        try:
            result = renew_client(db, order.client_id, term)
            order.status       = "issued"
            order.expires_at   = result.get("expires_at", "")
            order.server_id    = "local"
            order.server_name  = "Local"
            order.processed_at = datetime.now().isoformat(timespec="seconds")
        except HTTPException as e:
            order.processing_error = str(e.detail)
        return order

    name    = (order.login or f"order-{order.id[:8]}").strip()
    contact = (order.email or "").strip()
    try:
        result = create_client(db, name, term, contact)
        order.status            = "issued"
        order.client_id         = result["id"]
        order.client_public_key = result["public_key"]
        order.expires_at        = result.get("expires_at", "")
        order.server_id         = "local"
        order.server_name       = "Local"
        order.processed_at      = datetime.now().isoformat(timespec="seconds")
    except Exception as e:
        order.processing_error = str(e)

    return order
