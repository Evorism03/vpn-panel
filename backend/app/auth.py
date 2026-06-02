from datetime import datetime, timedelta, timezone
from typing import Optional
import secrets

from fastapi import Depends, HTTPException, Cookie, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from .config import get_settings
from .database import Admin, get_db

cfg = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer = HTTPBearer(auto_error=False)

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(admin_id: str, username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=cfg.access_token_expire_minutes)
    return jwt.encode(
        {"sub": admin_id, "username": username, "exp": expire, "type": "access"},
        cfg.secret_key,
        algorithm=ALGORITHM,
    )


def create_refresh_token(admin_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=cfg.refresh_token_expire_days)
    return jwt.encode(
        {"sub": admin_id, "exp": expire, "type": "refresh"},
        cfg.secret_key,
        algorithm=ALGORITHM,
    )


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, cfg.secret_key, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def get_current_admin(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> Admin:
    token = None
    if credentials:
        token = credentials.credentials
    elif authorization and authorization.startswith("Bearer "):
        token = authorization[7:]

    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = decode_token(token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")

    admin = db.query(Admin).filter(Admin.id == payload["sub"]).first()
    if not admin or not admin.is_active:
        raise HTTPException(status_code=401, detail="Admin not found or inactive")

    return admin


def require_superadmin(admin: Admin = Depends(get_current_admin)) -> Admin:
    if admin.role != "superadmin":
        raise HTTPException(status_code=403, detail="Superadmin role required")
    return admin


def bootstrap_admin(db: Session):
    if db.query(Admin).count() > 0:
        return
    admin = Admin(
        id=secrets.token_hex(8),
        username=cfg.admin_username,
        hashed_password=hash_password(cfg.admin_password),
        display_name="Super Admin",
        role="superadmin",
    )
    db.add(admin)
    db.commit()
