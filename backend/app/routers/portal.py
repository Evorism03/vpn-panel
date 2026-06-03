"""Client cabinet API — auth by client_id."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import Client, Order, get_db
from ..services.orders import renew_client

router = APIRouter(prefix="/api/portal", tags=["portal"])


class PortalAuth(BaseModel):
    # Either client_id OR email — one must be provided
    client_id: str = ""
    email: str = ""


@router.post("/auth")
def portal_auth(body: PortalAuth, db: Session = Depends(get_db)):
    """Login by client_id OR email."""
    client_id = body.client_id.strip()
    email     = body.email.strip().lower()

    if not client_id and not email:
        raise HTTPException(400, "Укажите ID клиента или email")

    client = None

    # 1. Try by client_id
    if client_id:
        client = db.query(Client).filter(Client.id == client_id).first()

    # 2. Try by email
    if client is None and email:
        from sqlalchemy import func
        client = (db.query(Client)
                  .filter(func.lower(Client.contact) == email)
                  .filter(Client.status != "expired")
                  .order_by(Client.created_at.desc())
                  .first())
        # Fallback: include expired if no active found
        if client is None:
            client = (db.query(Client)
                      .filter(func.lower(Client.contact) == email)
                      .order_by(Client.created_at.desc())
                      .first())

    if client is None:
        raise HTTPException(404, "Клиент не найден")

    return {"client": _client_dict(client), "client_id": client.id}


@router.get("/client/{client_id}")
def get_client(client_id: str, db: Session = Depends(get_db)):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(404, "Client not found")
    return {"client": _client_dict(client)}


@router.get("/client/{client_id}/config")
def download_config(client_id: str, db: Session = Depends(get_db)):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client or not client.config_text:
        raise HTTPException(404, "Config not available")
    filename = f"{client.name or client_id}.conf"
    return Response(
        content=client.config_text,
        media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/client/{client_id}/orders")
def get_orders(client_id: str, db: Session = Depends(get_db)):
    orders = (db.query(Order)
              .filter(Order.client_id == client_id)
              .order_by(Order.created_at.desc())
              .all())
    return {"orders": [_order_dict(o) for o in orders]}


class RenewRequest(BaseModel):
    term: str = "1m"


@router.post("/client/{client_id}/renew")
def renew(client_id: str, body: RenewRequest, db: Session = Depends(get_db)):
    result = renew_client(db, client_id, body.term)
    return result


def _client_dict(c: Client) -> dict:
    return {
        "id": c.id, "name": c.name,
        "contact": c.contact, "status": c.status,
        "expires_at": c.expires_at, "created_at": c.created_at,
        "server_id": c.server_id,
    }


def _order_dict(o: Order) -> dict:
    return {
        "id": o.id, "term": o.term, "status": o.status,
        "expires_at": o.expires_at, "payment_amount": o.payment_amount,
        "paid_at": o.paid_at,
        "created_at": o.created_at.isoformat() if o.created_at else None,
    }
