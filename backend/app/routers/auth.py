from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import (
    create_access_token, create_refresh_token,
    decode_token, get_current_admin, verify_password,
)
from ..database import Admin, get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(body: LoginRequest, db: Session = Depends(get_db)):
    admin = db.query(Admin).filter(Admin.username == body.username).first()
    if not admin or not verify_password(body.password, admin.hashed_password):
        raise HTTPException(401, "Invalid credentials")
    if not admin.is_active:
        raise HTTPException(403, "Account is disabled")

    admin.last_login = datetime.now(timezone.utc)
    db.commit()

    access = create_access_token(admin.id, admin.username)
    refresh = create_refresh_token(admin.id)
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "admin": {
            "id": admin.id,
            "username": admin.username,
            "display_name": admin.display_name,
            "role": admin.role,
        },
    }


class RefreshRequest(BaseModel):
    refresh_token: str


@router.post("/refresh")
def refresh(body: RefreshRequest, db: Session = Depends(get_db)):
    payload = decode_token(body.refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(401, "Invalid token type")
    admin = db.query(Admin).filter(Admin.id == payload["sub"]).first()
    if not admin or not admin.is_active:
        raise HTTPException(401, "Admin not found")
    access = create_access_token(admin.id, admin.username)
    return {"access_token": access, "token_type": "bearer"}


@router.get("/me")
def me(admin: Admin = Depends(get_current_admin)):
    return {
        "id": admin.id,
        "username": admin.username,
        "display_name": admin.display_name,
        "role": admin.role,
    }
