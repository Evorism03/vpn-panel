"""Public shop & payment API — no auth required."""
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import Order, get_db
from ..services import lava
from ..services.limiter import limiter
from ..services.orders import process_order

cfg = get_settings()
router = APIRouter(prefix="/api/shop", tags=["shop"])


@router.get("/config")
def shop_config():
    """Public: pricing and payment availability."""
    return {
        "panel_name": cfg.panel_name,
        "payments_enabled": lava.is_enabled(),
        "prices": lava.prices_map(),
    }


class OrderCreate(BaseModel):
    login: str = ""
    email: str = ""
    term: str = "1m"
    client_id: str = ""


@router.post("/order")
@limiter.limit("5/minute")
def create_order(request: Request, body: OrderCreate, db: Session = Depends(get_db)):
    login = body.login.strip()
    email = body.email.strip()
    term = body.term.strip() or "1m"
    client_id = body.client_id.strip()

    if not client_id:
        if not login:
            raise HTTPException(400, "Login is required")
        if not email:
            raise HTTPException(400, "Email is required")

    order = Order(
        id=secrets.token_hex(8),
        login=login or client_id,
        email=email,
        term=term,
        client_id=client_id or None,
        type="renewal" if client_id else "new",
        status="pending",
    )
    db.add(order)

    # Try to process immediately
    order = process_order(db, order)
    db.commit()

    return {"order": _order_dict(order)}


class PaymentCreate(BaseModel):
    order_id: str
    term: str = ""
    email: str = ""


@router.post("/payment")
def create_payment(body: PaymentCreate, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.id == body.order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")
    if order.status == "issued":
        raise HTTPException(400, "Order already issued")

    term = body.term.strip() or order.term or "1m"
    email = body.email.strip() or order.email or ""

    try:
        result = lava.create_invoice(body.order_id, term, email)
    except ValueError as e:
        raise HTTPException(400, str(e))

    order.invoice_id = result["invoice_id"]
    order.payment_amount = result["amount"]
    db.commit()

    return result


@router.post("/payment/webhook")
async def payment_webhook(request: Request, db: Session = Depends(get_db)):
    import json
    raw = await request.body()
    sig = request.headers.get("X-Signature", "")

    if not lava.verify_webhook(raw, sig):
        raise HTTPException(400, "Invalid signature")

    try:
        data = json.loads(raw)
    except Exception:
        raise HTTPException(400, "Invalid JSON")

    order_id = data.get("orderId") or data.get("order_id", "")
    status = data.get("status", "")

    if status != "success":
        return {"ok": True}

    if not order_id:
        raise HTTPException(400, "Missing orderId")

    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")

    if order.status == "issued":
        return {"ok": True}

    order.paid_at = datetime.now().isoformat(timespec="seconds")
    order = process_order(db, order)
    db.commit()

    return {"ok": True}


def _order_dict(o: Order) -> dict:
    return {
        "id": o.id, "status": o.status, "type": o.type,
        "client_id": o.client_id, "expires_at": o.expires_at,
        "term": o.term, "payment_amount": o.payment_amount,
        "created_at": o.created_at.isoformat() if o.created_at else None,
    }
