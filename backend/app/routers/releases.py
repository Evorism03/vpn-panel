"""Client app releases — superadmin upload, public download.

Files live under `cfg.releases_dir/<platform>/<release_id><ext>` (inside the
existing `./data` bind mount, no new docker volume needed).
"""
import os
import secrets

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..auth import get_current_admin, require_superadmin
from ..config import get_settings
from ..database import Admin, Release, get_db
from .admin import log

cfg = get_settings()

router = APIRouter(prefix="/api", tags=["releases"])

PLATFORMS = {"android", "windows"}
ALLOWED_EXT = {"android": ".apk", "windows": ".exe"}
MAX_SIZE = 500 * 1024 * 1024  # 500 MB
CHUNK_SIZE = 1024 * 1024


def _release_dict(r: Release) -> dict:
    return {
        "id": r.id, "platform": r.platform, "version": r.version,
        "filename": r.filename, "size_bytes": r.size_bytes,
        "notes": r.notes, "uploaded_by": r.uploaded_by,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


# ── Admin: manage releases ──────────────────────────────────────────────────────

@router.get("/admin/releases")
def list_releases(
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    releases = db.query(Release).order_by(Release.created_at.desc()).all()
    return {"releases": [_release_dict(r) for r in releases]}


@router.post("/admin/releases")
def upload_release(
    platform: str = Form(...),
    version: str = Form(...),
    notes: str = Form(""),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_superadmin),
):
    platform = platform.strip().lower()
    version = version.strip()
    if platform not in PLATFORMS:
        raise HTTPException(400, "platform must be 'android' or 'windows'")
    if not version:
        raise HTTPException(400, "version is required")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext != ALLOWED_EXT[platform]:
        raise HTTPException(400, f"Expected a {ALLOWED_EXT[platform]} file for {platform}")

    release_dir = os.path.join(cfg.releases_dir, platform)
    os.makedirs(release_dir, exist_ok=True)

    release_id = secrets.token_hex(8)
    dest_filename = f"{release_id}{ext}"
    dest_path = os.path.join(release_dir, dest_filename)

    size = 0
    with open(dest_path, "wb") as out:
        while chunk := file.file.read(CHUNK_SIZE):
            size += len(chunk)
            if size > MAX_SIZE:
                out.close()
                os.remove(dest_path)
                raise HTTPException(413, "File too large (max 500MB)")
            out.write(chunk)

    release = Release(
        id=release_id, platform=platform, version=version,
        filename=dest_filename, size_bytes=size, notes=notes.strip(),
        uploaded_by=admin.username,
    )
    db.add(release)
    db.commit()
    log(db, "release.upload", "release", release_id, admin,
        {"platform": platform, "version": version, "size_bytes": size})
    return {"release": _release_dict(release)}


@router.delete("/admin/releases/{release_id}")
def delete_release(
    release_id: str,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_superadmin),
):
    release = db.query(Release).filter(Release.id == release_id).first()
    if not release:
        raise HTTPException(404, "Release not found")
    path = os.path.join(cfg.releases_dir, release.platform, release.filename)
    if os.path.exists(path):
        os.remove(path)
    db.delete(release)
    db.commit()
    log(db, "release.delete", "release", release_id, admin,
        {"platform": release.platform, "version": release.version})
    return {"ok": True}


# ── Public: latest version + download ───────────────────────────────────────────

@router.get("/releases/latest")
def latest_release(platform: str, db: Session = Depends(get_db)):
    platform = platform.strip().lower()
    if platform not in PLATFORMS:
        raise HTTPException(400, "platform must be 'android' or 'windows'")
    release = (
        db.query(Release)
        .filter(Release.platform == platform)
        .order_by(Release.created_at.desc())
        .first()
    )
    if not release:
        raise HTTPException(404, "No release available")
    return _release_dict(release)


@router.get("/releases/{release_id}/download")
def download_release(release_id: str, db: Session = Depends(get_db)):
    release = db.query(Release).filter(Release.id == release_id).first()
    if not release:
        raise HTTPException(404, "Release not found")
    path = os.path.join(cfg.releases_dir, release.platform, release.filename)
    if not os.path.exists(path):
        raise HTTPException(404, "File missing on disk")
    ext = os.path.splitext(release.filename)[1]
    download_name = f"lab_vpn_{release.version}{ext}"
    return FileResponse(path, filename=download_name, media_type="application/octet-stream")
