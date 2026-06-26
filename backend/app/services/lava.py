"""Lava.top payment integration."""
import hashlib
import hmac
import json
from typing import Optional

import httpx
from fastapi import HTTPException

from ..config import get_settings

cfg = get_settings()

LAVA_API = "https://api.lava.top/business/invoice"

PRICES = {
    "3d":  cfg.price_3d,
    "7d":  cfg.price_7d,
    "14d": cfg.price_14d,
    "1m":  cfg.price_1m,
    "3m":  cfg.price_3m,
    "6m":  cfg.price_6m,
    "1y":  cfg.price_1y,
}

TERM_LABELS = {
    "3d":  "3 дня",
    "7d":  "7 дней",
    "14d": "14 дней",
    "1m":  "1 месяц",
    "3m":  "3 месяца",
    "6m":  "6 месяцев",
    "1y":  "1 год",
}


def is_enabled() -> bool:
    return bool(cfg.lava_api_key and cfg.lava_shop_id)


def prices_map() -> dict:
    return {
        term: {"amount": amount, "label": TERM_LABELS.get(term, term)}
        for term, amount in PRICES.items()
    }


def create_invoice(order_id: str, term: str, email: str) -> dict:
    if not is_enabled():
        raise ValueError("Payment system is not configured")
    amount = PRICES.get(term)
    if not amount:
        raise ValueError(f"No price for term: {term}")
    payload = {
        "shopId": cfg.lava_shop_id,
        "orderId": order_id,
        "sum": amount,
        "currency": "RUB",
        "comment": f"{cfg.panel_name} — {TERM_LABELS.get(term, term)}",
        "successUrl": cfg.lava_success_url,
        "failUrl": cfg.lava_fail_url,
        "email": email,
    }
    headers = {
        "Authorization": f"Bearer {cfg.lava_api_key}",
        "Content-Type": "application/json",
    }
    try:
        r = httpx.post(LAVA_API, json=payload, headers=headers, timeout=10)
        data = r.json()
    except Exception as e:
        raise HTTPException(502, f"Lava API error: {e}")
    if r.status_code >= 400:
        raise HTTPException(502, data.get("message", "Lava error"))
    return {
        "invoice_id": data.get("id", ""),
        "pay_url": data.get("url", ""),
        "amount": amount,
        "term": term,
    }


def verify_webhook(body: bytes, signature: str) -> bool:
    if not cfg.lava_api_key:
        return False
    expected = hmac.new(cfg.lava_api_key.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
