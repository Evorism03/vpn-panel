"""Client cabinet API — auth by client_id."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import Client, Order, get_db
from ..services.orders import renew_client

router = APIRouter(prefix="/api/portal", tags=["portal"])


class PortalAuth(BaseModel):
    client_id: str
    contact: str = ""


@router.post("/auth")
def portal_auth(body: PortalAuth, db: Session = Depends(get_db)):
    """Login to cabinet by client_id (+ optional contact verification)."""
    client = db.query(Client).filter(Client.id == body.client_id.strip()).first()
    if not client:
        raise HTTPException(404, "Client not found")
    # Optional: verify contact matches
    if body.contact.strip() and client.contact:
        if body.contact.strip().lower() != client.contact.lower():
            raise HTTPException(403, "Contact does not match")
    return {"client": _client_dict(client)}


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
