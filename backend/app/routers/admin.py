"""Admin API — requires JWT auth."""
import io
import json
import os
import secrets
import zipfile
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..auth import get_current_admin, hash_password, require_superadmin
from ..config import get_settings
from ..database import Admin, AuditLog, Client, Order, Server, get_db
from ..services import awg as awg_svc
from .servers import _json as _remote_json, _server_creds
from ..services.orders import (
    create_client, delete_client_from_cfg,
    enforce_expired, process_order, renew_client, restore_client_peer,
)

cfg = get_settings()

router = APIRouter(prefix="/api/admin", tags=["admin"])


def log(db: Session, action: str, entity_type: str, entity_id: str,
        admin: Admin, details: dict = {}):
    db.add(AuditLog(
        action=action, entity_type=entity_type, entity_id=entity_id,
        admin_id=admin.id, admin_username=admin.username,
        details=json.dumps(details, ensure_ascii=False),
    ))
    db.commit()


# ── Clients ────────────────────────────────────────────────────────────────────

class ClientCreate(BaseModel):
    name: str
    term: str = "1m"
    contact: str = ""
    expires_at: Optional[str] = None
    server_id: str = "local"


class ClientUpdate(BaseModel):
    name: Optional[str] = None
    contact: Optional[str] = None


class ClientRenew(BaseModel):
    term: str = "1m"


class ClientExpiry(BaseModel):
    expires_at: Optional[str] = None


class ClientTransfer(BaseModel):
    target_server_id: str


@router.get("/clients")
def list_clients(
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(200, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    enforce_expired(db)
    q = db.query(Client)
    if status:
        q = q.filter(Client.status == status)
    if search:
        s = f"%{search}%"
        q = q.filter(or_(
            Client.name.ilike(s),
            Client.contact.ilike(s),
            Client.id.ilike(s),
        ))
    total = q.count()
    clients = q.order_by(Client.created_at.desc()).offset(offset).limit(limit).all()
    return {"clients": [_client_dict(c) for c in clients], "total": total}


@router.post("/clients")
def add_client(
    body: ClientCreate,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    server_id = (body.server_id or "local").strip()

    if server_id == "local":
        result = create_client(db, body.name.strip(), body.term, body.contact, body.expires_at)
        log(db, "client.create", "client", result["id"], admin,
            {"name": body.name, "term": body.term, "server_id": "local", "server_name": "Локальный"})
        return {"client": result}

    # Remote server
    s = db.query(Server).filter(Server.id == server_id).first()
    if not s:
        raise HTTPException(404, "Server not found")
    if not s.is_active:
        raise HTTPException(400, "Сервер отключён")
    if s.max_users == -1:
        raise HTTPException(403, f"Создание клиентов на сервере «{s.name}» запрещено")

    payload: dict = {"name": body.name.strip(), "term": body.term, "contact": body.contact or ""}
    if body.expires_at:
        payload["expires_at"] = body.expires_at

    remote_result = _remote_json(_server_creds(s), "POST", "/admin/clients", payload)
    client = remote_result.get("client", remote_result)
    client_id = client.get("id", "unknown")

    log(db, "client.create", "client", client_id, admin,
        {"name": body.name, "term": body.term, "server_id": server_id, "server_name": s.name})
    return {"client": client}


@router.patch("/clients/{client_id}")
def update_client(
    client_id: str,
    body: ClientUpdate,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(404, "Client not found")
    if body.name is not None:
        client.name = body.name.strip()
    if body.contact is not None:
        client.contact = body.contact.strip()
    db.commit()
    log(db, "client.update", "client", client_id, admin)
    return {"client": _client_dict(client)}


@router.delete("/clients/{client_id}")
def delete_client(
    client_id: str,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(404, "Client not found")
    server_name = "Локальный"
    if client.server_id and client.server_id != "local":
        s = db.query(Server).filter(Server.id == client.server_id).first()
        server_name = s.name if s else client.server_id
    delete_client_from_cfg(client.public_key)
    log(db, "client.delete", "client", client_id, admin,
        {"name": client.name, "server_id": client.server_id or "local", "server_name": server_name})
    db.delete(client)
    db.commit()
    return {"ok": True}


@router.post("/clients/{client_id}/renew")
def renew(
    client_id: str,
    body: ClientRenew,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    result = renew_client(db, client_id, body.term)
    log(db, "client.renew", "client", client_id, admin, {"term": body.term})
    return result


@router.post("/clients/{client_id}/block")
def block_client(
    client_id: str,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(404, "Client not found")
    if client.status == "blocked":
        return {"client": _client_dict(client)}
    delete_client_from_cfg(client.public_key)
    client.status = "blocked"
    client.blocked_at = date.today().isoformat()
    db.commit()
    log(db, "client.block", "client", client_id, admin, {"name": client.name})
    return {"client": _client_dict(client)}


@router.post("/clients/{client_id}/unblock")
def unblock_client(
    client_id: str,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(404, "Client not found")
    if client.status != "blocked":
        return {"client": _client_dict(client)}
    restore_client_peer(client)
    client.status = "active"
    client.blocked_at = None
    db.commit()
    log(db, "client.unblock", "client", client_id, admin, {"name": client.name})
    return {"client": _client_dict(client)}


@router.patch("/clients/{client_id}/expiry")
def set_expiry(
    client_id: str,
    body: ClientExpiry,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(404, "Client not found")
    client.expires_at = body.expires_at
    db.commit()
    log(db, "client.set_expiry", "client", client_id, admin, {"expires_at": body.expires_at})
    return {"client": _client_dict(client)}


@router.get("/clients/{client_id}/config")
def get_config(
    client_id: str,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client or not client.config_text:
        raise HTTPException(404, "Config not found")
    return {"config": client.config_text, "filename": f"{client.name or client_id}.conf"}


@router.post("/clients/{client_id}/transfer")
def transfer_client(
    client_id: str,
    body: ClientTransfer,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    """Move a client from this (local) server to another registered server.

    Re-creates the client on the target with fresh keys (old config is
    revoked), then removes it here — the client gets a new config to install.
    """
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(404, "Client not found")

    target_id = body.target_server_id.strip()
    if not target_id or target_id == "local":
        raise HTTPException(400, "Укажите другой (удалённый) сервер для переноса")

    target = db.query(Server).filter(Server.id == target_id).first()
    if not target:
        raise HTTPException(404, "Целевой сервер не найден")
    if not target.is_active:
        raise HTTPException(400, "Целевой сервер отключён")
    if target.max_users == -1:
        raise HTTPException(403, f"Создание клиентов на сервере «{target.name}» запрещено")

    payload: dict = {"name": client.name, "term": "1m", "contact": client.contact or ""}
    if client.expires_at:
        payload["expires_at"] = client.expires_at

    remote_result = _remote_json(_server_creds(target), "POST", "/admin/clients", payload)
    new_client = remote_result.get("client", remote_result)

    # Only remove the local copy once the target confirms creation.
    delete_client_from_cfg(client.public_key)
    db.delete(client)
    db.commit()

    log(db, "client.transfer", "client", client_id, admin,
        {"name": client.name, "from_server": "local", "to_server": target_id,
         "to_server_name": target.name, "new_client_id": new_client.get("id")})
    return {"client": new_client}


# ── Orders ─────────────────────────────────────────────────────────────────────

@router.get("/orders")
def list_orders(
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(200, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    q = db.query(Order)
    if status:
        q = q.filter(Order.status == status)
    if search:
        s = f"%{search}%"
        q = q.filter(or_(
            Order.login.ilike(s),
            Order.email.ilike(s),
            Order.id.ilike(s),
        ))
    total = q.count()
    orders = q.order_by(Order.created_at.desc()).offset(offset).limit(limit).all()
    return {"orders": [_order_dict(o) for o in orders], "total": total}


@router.post("/orders/{order_id}/process")
def process_order_endpoint(
    order_id: str,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")
    if order.status == "issued":
        raise HTTPException(400, "Order already issued")
    updated = process_order(db, order)
    db.commit()
    log(db, "order.process", "order", order_id, admin, {"status": updated.status})
    return {"order": _order_dict(updated)}


@router.delete("/orders/{order_id}")
def delete_order(
    order_id: str,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")
    db.delete(order)
    db.commit()
    log(db, "order.delete", "order", order_id, admin)
    return {"ok": True}


# ── Admins (superadmin only) ───────────────────────────────────────────────────

class AdminCreate(BaseModel):
    username: str
    password: str
    display_name: str = ""
    role: str = "admin"


class AdminUpdate(BaseModel):
    display_name: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/admins")
def list_admins(
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_superadmin),
):
    admins = db.query(Admin).all()
    return {"admins": [_admin_dict(a) for a in admins]}


@router.post("/admins")
def create_admin(
    body: AdminCreate,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_superadmin),
):
    if db.query(Admin).filter(Admin.username == body.username).first():
        raise HTTPException(400, "Username already exists")
    new_admin = Admin(
        id=secrets.token_hex(8),
        username=body.username.strip(),
        hashed_password=hash_password(body.password),
        display_name=body.display_name.strip(),
        role=body.role if body.role in ("superadmin", "admin") else "admin",
    )
    db.add(new_admin)
    db.commit()
    log(db, "admin.create", "admin", new_admin.id, admin, {"username": body.username})
    return {"admin": _admin_dict(new_admin)}


@router.patch("/admins/{admin_id}")
def update_admin(
    admin_id: str,
    body: AdminUpdate,
    db: Session = Depends(get_db),
    current: Admin = Depends(require_superadmin),
):
    target = db.query(Admin).filter(Admin.id == admin_id).first()
    if not target:
        raise HTTPException(404, "Admin not found")
    if body.display_name is not None:
        target.display_name = body.display_name.strip()
    if body.password:
        target.hashed_password = hash_password(body.password)
    if body.role in ("superadmin", "admin"):
        target.role = body.role
    if body.is_active is not None:
        target.is_active = body.is_active
    db.commit()
    log(db, "admin.update", "admin", admin_id, current)
    return {"admin": _admin_dict(target)}


@router.delete("/admins/{admin_id}")
def delete_admin(
    admin_id: str,
    db: Session = Depends(get_db),
    current: Admin = Depends(require_superadmin),
):
    if admin_id == current.id:
        raise HTTPException(400, "Cannot delete yourself")
    target = db.query(Admin).filter(Admin.id == admin_id).first()
    if not target:
        raise HTTPException(404, "Admin not found")
    db.delete(target)
    db.commit()
    return {"ok": True}


# ── Audit log ──────────────────────────────────────────────────────────────────

@router.get("/audit")
def audit_log(
    limit: int = Query(100, le=500),
    offset: int = Query(0),
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    logs = (db.query(AuditLog)
            .order_by(AuditLog.created_at.desc())
            .offset(offset).limit(limit).all())
    return {"logs": [_log_dict(l) for l in logs]}


# ── Backup ─────────────────────────────────────────────────────────────────────

@router.get("/backup")
def backup(admin: Admin = Depends(get_current_admin)):
    """Download a zip archive containing the SQLite DB, AWG config file, and
    uploaded release binaries — extracting it into ./data on a new server
    restores everything the `releases` table refers to (otherwise downloads
    404 with "File missing on disk" after a migration)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        if os.path.exists(cfg.db_path):
            zf.write(cfg.db_path, "vpn.db")
        if not cfg.awg_docker_container and os.path.exists(cfg.awg_config_path):
            zf.write(cfg.awg_config_path, "awg0.conf")
        if os.path.isdir(cfg.releases_dir):
            for root, _dirs, files in os.walk(cfg.releases_dir):
                for fname in files:
                    full = os.path.join(root, fname)
                    arcname = os.path.join("releases", os.path.relpath(full, cfg.releases_dir))
                    zf.write(full, arcname)
    buf.seek(0)
    return Response(
        content=buf.read(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="vpn-backup.zip"'},
    )


# ── Stats ──────────────────────────────────────────────────────────────────────

@router.get("/stats")
def stats(
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    total   = db.query(Client).count()
    active  = db.query(Client).filter(Client.status == "active").count()
    expired = db.query(Client).filter(Client.status == "expired").count()
    blocked = db.query(Client).filter(Client.status == "blocked").count()
    pending = db.query(Order).filter(Order.status == "pending").count()
    issued  = db.query(Order).filter(Order.status == "issued").count()
    dump    = awg_svc.awg_show_dump()
    return {
        "clients": {"total": total, "active": active, "expired": expired, "blocked": blocked},
        "orders":  {"pending": pending, "issued": issued},
        "dump":    dump,
    }


# ── Helpers ────────────────────────────────────────────────────────────────────

def _client_dict(c: Client) -> dict:
    return {
        "id": c.id, "name": c.name, "public_key": c.public_key,
        "contact": c.contact, "server_id": c.server_id,
        "status": c.status, "expires_at": c.expires_at,
        "created_at": c.created_at, "blocked_at": c.blocked_at,
    }


def _order_dict(o: Order) -> dict:
    return {
        "id": o.id, "login": o.login, "email": o.email, "term": o.term,
        "status": o.status, "type": o.type, "client_id": o.client_id,
        "server_id": o.server_id, "expires_at": o.expires_at,
        "invoice_id": o.invoice_id, "payment_amount": o.payment_amount,
        "paid_at": o.paid_at, "processing_error": o.processing_error,
        "created_at": o.created_at.isoformat() if o.created_at else None,
        "processed_at": o.processed_at,
    }


def _admin_dict(a: Admin) -> dict:
    return {
        "id": a.id, "username": a.username, "display_name": a.display_name,
        "role": a.role, "is_active": a.is_active,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "last_login": a.last_login.isoformat() if a.last_login else None,
    }


def _log_dict(l: AuditLog) -> dict:
    return {
        "id": l.id, "action": l.action, "entity_type": l.entity_type,
        "entity_id": l.entity_id, "admin_username": l.admin_username,
        "details": l.details,
        "created_at": l.created_at.isoformat() if l.created_at else None,
    }
