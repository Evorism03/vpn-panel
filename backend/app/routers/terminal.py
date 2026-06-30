"""WebSocket PTY terminal — superadmin only, Linux/Docker only."""
import asyncio
import fcntl
import json
import os
import shutil
import struct
import termios
from typing import Optional

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from ..auth import decode_token
from ..database import Admin, SessionLocal

router = APIRouter()


def _resize(fd: int, rows: int, cols: int) -> None:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


@router.websocket("/api/admin/terminal")
async def terminal_ws(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
):
    # ── Auth ──────────────────────────────────────────────────────────────────
    if not token:
        await websocket.close(code=4401)
        return
    try:
        payload = decode_token(token)
    except Exception:
        await websocket.close(code=4401)
        return

    db = SessionLocal()
    try:
        admin = db.query(Admin).filter(Admin.id == payload["sub"]).first()
        if not admin or not admin.is_active or admin.role != "superadmin":
            await websocket.close(code=4403)
            return
    finally:
        db.close()

    await websocket.accept()

    # ── PTY ───────────────────────────────────────────────────────────────────
    try:
        import pty as _pty
        master_fd, slave_fd = _pty.openpty()
    except ImportError:
        await websocket.send_text("\r\nTerminal not available on this platform.\r\n")
        await websocket.close()
        return

    _resize(master_fd, 24, 80)

    shell = shutil.which("bash") or shutil.which("sh") or "/bin/sh"
    proc = await asyncio.create_subprocess_exec(
        shell, "--login",
        stdin=slave_fd, stdout=slave_fd, stderr=slave_fd,
        env={**os.environ, "TERM": "xterm-256color", "COLORTERM": "truecolor"},
    )
    os.close(slave_fd)

    loop = asyncio.get_running_loop()

    # ── PTY → WebSocket ───────────────────────────────────────────────────────
    async def pty_to_ws() -> None:
        while True:
            try:
                data = await loop.run_in_executor(None, lambda: os.read(master_fd, 4096))
                await websocket.send_bytes(data)
            except OSError:
                break
            except Exception:
                break

    # ── WebSocket → PTY ───────────────────────────────────────────────────────
    async def ws_to_pty() -> None:
        try:
            while True:
                msg = await websocket.receive()
                if msg.get("type") == "websocket.disconnect":
                    break

                raw: bytes = msg.get("bytes") or (msg.get("text") or "").encode()
                if not raw:
                    continue

                # Resize command comes as JSON
                try:
                    obj = json.loads(raw)
                    if obj.get("type") == "resize":
                        _resize(master_fd, int(obj["rows"]), int(obj["cols"]))
                        continue
                except Exception:
                    pass

                os.write(master_fd, raw)
        except WebSocketDisconnect:
            pass
        except Exception:
            pass

    t1 = asyncio.create_task(pty_to_ws())
    t2 = asyncio.create_task(ws_to_pty())
    await asyncio.wait([t1, t2], return_when=asyncio.FIRST_COMPLETED)
    t1.cancel()
    t2.cancel()

    try:
        proc.terminate()
        await asyncio.wait_for(proc.wait(), timeout=3)
    except Exception:
        pass
    try:
        os.close(master_fd)   # unblocks run_in_executor thread
    except OSError:
        pass
    try:
        await websocket.close()
    except Exception:
        pass
