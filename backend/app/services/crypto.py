"""Fernet-based symmetric encryption for sensitive DB values (server tokens)."""
from cryptography.fernet import Fernet, InvalidToken
from ..config import get_settings

cfg = get_settings()

_fernet_instance: Fernet | None = None
_fernet_key_used: str = ""


def _fernet() -> Fernet | None:
    global _fernet_instance, _fernet_key_used
    if not cfg.fernet_key:
        return None
    if _fernet_key_used != cfg.fernet_key:
        try:
            _fernet_instance = Fernet(cfg.fernet_key.encode())
            _fernet_key_used = cfg.fernet_key
        except Exception:
            return None
    return _fernet_instance


def encrypt(value: str) -> str:
    f = _fernet()
    if not f or not value:
        return value
    return f.encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    f = _fernet()
    if not f or not value:
        return value
    try:
        return f.decrypt(value.encode()).decode()
    except (InvalidToken, Exception):
        return value  # not encrypted or wrong key — return as-is
