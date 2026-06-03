import asyncio
import json
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Cookie, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import StreamingResponse

from .auth import bootstrap_admin, decode_token
from .database import SessionLocal, init_db
from .routers import admin, auth, portal, shop
from .services.awg import get_cfg_hash
from .services.orders import enforce_expired
from . import broadcast as _bc

# ── SSE broadcast bus ──────────────────────────────────────────────────────────
# Each connected admin gets their own asyncio.Queue.
# When any backend action changes data we call `broadcast(event)` — all queues get the message.

_sse_queues: list[asyncio.Queue] = []


def broadcast(event: str):
    """Notify all connected SSE clients. Thread-safe."""
    for q in list(_sse_queues):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass


_bc.set_handler(broadcast)


# ── Background tasks ───────────────────────────────────────────────────────────

async def _cfg_monitor():
    """Detect AWG config file changes and broadcast to all admins."""
    last_hash = ""
    while True:
        await asyncio.sleep(3)
        try:
            h = await asyncio.to_thread(get_cfg_hash)
            if h and h != last_hash:
                last_hash = h
                broadcast("clients")
        except Exception:
            pass


async def _expiry_enforcer():
    """Hourly expiry check — moves expired peers out of AWG config."""
    while True:
        await asyncio.sleep(3600)
        try:
            db = SessionLocal()
            try:
                changed = await asyncio.to_thread(enforce_expired, db)
                if changed:
                    broadcast("clients")
            finally:
                db.close()
        except Exception:
            pass


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    db = SessionLocal()
    try:
        bootstrap_admin(db)
        try:
            enforce_expired(db)
        except Exception:
            pass  # AWG may not be reachable at startup — that's fine
    finally:
        db.close()

    t1 = asyncio.create_task(_cfg_monitor())
    t2 = asyncio.create_task(_expiry_enforcer())
    yield
    t1.cancel()
    t2.cancel()


app = FastAPI(title="VPN Panel API", lifespan=lifespan)

app.add_middleware(GZipMiddleware, minimum_size=512)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(portal.router)
app.include_router(shop.router)


# ── SSE endpoint ───────────────────────────────────────────────────────────────

def _auth_sse(authorization: Optional[str], cookie: Optional[str]):
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
    elif cookie:
        token = cookie
    if not token:
        raise HTTPException(401, "Not authenticated")
    decode_token(token)   # raises 401 on invalid/expired


@app.get("/api/events")
async def sse_events(
    authorization: Optional[str] = Header(None),
    vpn_session: Optional[str] = Cookie(None),
    token: Optional[str] = None,   # query param for EventSource (no custom headers)
):
    _auth_sse(authorization or (f"Bearer {token}" if token else None), vpn_session)
    queue: asyncio.Queue = asyncio.Queue(maxsize=32)
    _sse_queues.append(queue)

    async def stream():
        try:
            yield "data: connected\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=25)
                    yield f"event: {event}\ndata: 1\n\n"
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"   # keep-alive so nginx/proxies don't close
        finally:
            try:
                _sse_queues.remove(queue)
            except ValueError:
                pass

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/health")
def health():
    return {"ok": True}
