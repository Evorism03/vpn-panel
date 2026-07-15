"""Remote server management + proxy API."""
import json
import secrets
import urllib.request
from typing import Optional
from urllib.error import HTTPError, URLError
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import get_current_admin
from ..database import Admin, Client, Server, get_db
from ..services.crypto import decrypt, encrypt

router = APIRouter(prefix="/api/admin/servers", tags=["servers"])

LOCAL_ID = "local"


# ── HTTP helpers ───────────────────────────────────────────────────────────────

def _request(server: dict, method: str, path: str,
             body: bytes | None = None, timeout: int = 8) -> tuple[int, bytes]:
    headers: dict = {}
    if server.get("token"):
        headers["Authorization"] = f"Bearer {server['token']}"
    if body is not None:
        headers["Content-Type"] = "application/json"
    url = f"{server['base_url'].rstrip('/')}/api{path}"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except HTTPError as e:
        return e.code, e.read()
    except URLError as e:
        raise HTTPException(502, f"Server unreachable: {e.reason}")


def _json(server: dict, method: str, path: str,
          payload: dict | None = None, timeout: int = 8):
    body = None if payload is None else json.dumps(payload).encode()
    status, raw = _request(server, method, path, body, timeout)
    text = raw.decode("utf-8", errors="replace")
    if status in (401, 403):
        raise HTTPException(502, "Remote auth failed — check server token")
    if status >= 400:
        raise HTTPException(status, text.strip() or "Remote error")
    try:
        return json.loads(text)
    except Exception:
        return text


def _probe(server: dict) -> str:
    try:
        status, _ = _request(server, "GET", "/health", timeout=3)
        return "online" if status == 200 else "degraded"
    except Exception:
        return "offline"


def _server_dict(s: Server, status: str = "unknown") -> dict:
    return {
        "id": s.id, "name": s.name, "base_url": s.base_url,
        "token": decrypt(s.token) if s.token else "",
        "max_users": s.max_users,
        "is_forbidden": s.max_users == -1,
        "is_active": s.is_active, "status": status,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


def _server_creds(s: Server) -> dict:
    """Return base_url + decrypted token for HTTP calls."""
    return {"base_url": s.base_url, "token": decrypt(s.token) if s.token else ""}


# ── Local server settings ─────────────────────────────────────────────────────

def _local_row(db: Session) -> Server | None:
    return db.query(Server).filter(Server.id == LOCAL_ID).first()

def _local_payload(db: Session, row: Server | None) -> dict:
    active = db.query(Client).filter(Client.status == "active").count()
    max_u  = row.max_users if row else 0
    return {
        "id": LOCAL_ID,
        "name": (row.name if row else None) or "Локальный сервер",
        "max_users": max_u,
        "active_count": active,
        "is_full": max_u > 0 and active >= max_u,
        "is_forbidden": max_u == -1,
    }


class LocalServerUpdate(BaseModel):
    max_users: int = 0
    name: Optional[str] = None


@router.get("/local")
def get_local_server(
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    return _local_payload(db, _local_row(db))


@router.patch("/local")
def update_local_server(
    body: LocalServerUpdate,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    row = _local_row(db)
    if row is None:
        row = Server(
            id=LOCAL_ID, name=body.name or "Локальный сервер",
            base_url="local", token="",
            max_users=max(-1, body.max_users),
        )
        db.add(row)
    else:
        row.max_users = max(-1, body.max_users)
        if body.name is not None:
            row.name = body.name.strip() or row.name
    db.commit()
    db.refresh(row)
    return _local_payload(db, row)


# ── CRUD ───────────────────────────────────────────────────────────────────────

class ServerCreate(BaseModel):
    name: str
    base_url: str
    token: str = ""
    max_users: int = 0


class ServerUpdate(BaseModel):
    name: Optional[str] = None
    base_url: Optional[str] = None
    token: Optional[str] = None
    max_users: Optional[int] = None
    is_active: Optional[bool] = None


@router.get("")
def list_servers(
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    # "local" — служебная строка с настройками локального сервера (см. _local_row),
    # не настоящий удалённый сервер — не должна попадать в общий список.
    servers = db.query(Server).filter(Server.id != LOCAL_ID).order_by(Server.created_at).all()
    if not servers:
        return {"servers": []}

    with ThreadPoolExecutor(max_workers=min(8, len(servers))) as pool:
        futures = [(s, pool.submit(_probe, _server_creds(s))) for s in servers]

    return {
        "servers": [
            _server_dict(s, f.result() if s.is_active else "disabled")
            for s, f in futures
        ]
    }


@router.post("")
def create_server(
    body: ServerCreate,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    name = body.name.strip()
    base_url = body.base_url.strip().rstrip("/")
    if not name:
        raise HTTPException(400, "Name is required")
    if not base_url:
        raise HTTPException(400, "URL is required")
    if not body.token.strip():
        raise HTTPException(400, "Token is required")
    if not base_url.startswith(("http://", "https://")):
        base_url = f"http://{base_url}"

    raw_token = body.token.strip()
    server = Server(
        id=secrets.token_hex(8),
        name=name, base_url=base_url,
        token=encrypt(raw_token),
        max_users=max(-1, body.max_users or 0),
    )
    db.add(server)
    db.commit()
    db.refresh(server)
    status = _probe({"base_url": server.base_url, "token": raw_token})
    return {"server": _server_dict(server, status)}


@router.put("/{server_id}")
def update_server(
    server_id: str,
    body: ServerUpdate,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    if server_id == LOCAL_ID:
        raise HTTPException(400, "Используйте PATCH /servers/local для локального сервера")
    s = db.query(Server).filter(Server.id == server_id).first()
    if not s:
        raise HTTPException(404, "Server not found")
    if body.name is not None:
        s.name = body.name.strip() or s.name
    if body.base_url is not None:
        url = body.base_url.strip().rstrip("/")
        if url and not url.startswith(("http://", "https://")):
            url = f"http://{url}"
        s.base_url = url or s.base_url
    if body.token is not None:
        s.token = encrypt(body.token.strip())
    if body.max_users is not None:
        s.max_users = max(-1, body.max_users)
    if body.is_active is not None:
        s.is_active = body.is_active
    db.commit()
    db.refresh(s)
    status = _probe(_server_creds(s)) if s.is_active else "disabled"
    return {"server": _server_dict(s, status)}


@router.delete("/{server_id}")
def delete_server(
    server_id: str,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    if server_id == LOCAL_ID:
        raise HTTPException(400, "Локальный сервер нельзя удалить")
    s = db.query(Server).filter(Server.id == server_id).first()
    if not s:
        raise HTTPException(404, "Server not found")
    db.delete(s)
    db.commit()
    return {"ok": True}


# ── Proxy — forward any admin request to remote server ────────────────────────

from fastapi import Request as _FR


@router.api_route("/{server_id}/proxy/{path:path}",
                  methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def proxy_handler(
    server_id: str,
    path: str,
    request: _FR,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    s = db.query(Server).filter(Server.id == server_id).first()
    if not s:
        raise HTTPException(404, "Server not found")
    body = await request.body()
    status, raw = _request(
        _server_creds(s),
        request.method,
        f"/{path}",
        body or None,
        timeout=15,
    )
    content_type = "application/json"
    return Response(content=raw, status_code=status, media_type=content_type)


# ── Remote clients (for aggregated view) ──────────────────────────────────────

@router.get("/{server_id}/clients")
def remote_clients(
    server_id: str,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    s = db.query(Server).filter(Server.id == server_id).first()
    if not s:
        raise HTTPException(404, "Server not found")
    data = _json(_server_creds(s), "GET", "/admin/clients")
    clients = data.get("clients", []) if isinstance(data, dict) else []
    for c in clients:
        c["serverId"] = server_id
        c["serverName"] = s.name
    return {"clients": clients, "serverName": s.name}


@router.get("/{server_id}/stats")
def remote_stats(
    server_id: str,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    s = db.query(Server).filter(Server.id == server_id).first()
    if not s:
        raise HTTPException(404, "Server not found")
    return _json(_server_creds(s), "GET", "/admin/stats")
