from sqlalchemy import create_engine, event, Column, String, Integer, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import DeclarativeBase, sessionmaker, relationship
from sqlalchemy.sql import func
from sqlalchemy.pool import StaticPool
from .config import get_settings
import os

cfg = get_settings()
os.makedirs(cfg.data_dir, exist_ok=True)

engine = create_engine(
    f"sqlite:///{cfg.db_path}",
    connect_args={
        "check_same_thread": False,
        "timeout": 10,          # wait up to 10s for lock instead of failing
    },
    # StaticPool shares one connection — fine for SQLite, avoids pool contention
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")    # concurrent reads + single writer, no full locks
    cur.execute("PRAGMA synchronous=NORMAL")  # safe but faster than FULL
    cur.execute("PRAGMA busy_timeout=8000")   # retry for 8s before raising OperationalError
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA cache_size=-16000")   # 16 MB page cache
    cur.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


class Admin(Base):
    __tablename__ = "admins"

    id            = Column(String, primary_key=True)
    username      = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    display_name  = Column(String, default="")
    role          = Column(String, default="admin")   # superadmin | admin
    is_active     = Column(Boolean, default=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())
    last_login    = Column(DateTime(timezone=True), nullable=True)

    audit_logs = relationship("AuditLog", back_populates="admin", lazy="dynamic")


class Client(Base):
    __tablename__ = "clients"

    id          = Column(String, primary_key=True)
    name        = Column(String, default="", index=True)
    public_key  = Column(String, unique=True, index=True)
    contact     = Column(String, default="")
    server_id   = Column(String, default="local", index=True)
    status      = Column(String, default="active", index=True)
    expires_at  = Column(String, nullable=True)
    created_at  = Column(String, nullable=False)
    blocked_at  = Column(String, nullable=True)
    config_text = Column(Text, nullable=True)


class Order(Base):
    __tablename__ = "orders"

    id               = Column(String, primary_key=True)
    login            = Column(String, default="")
    email            = Column(String, default="")
    term             = Column(String, default="1m")
    status           = Column(String, default="pending", index=True)
    type             = Column(String, default="new")
    client_id        = Column(String, nullable=True, index=True)
    client_public_key= Column(String, nullable=True)
    server_id        = Column(String, nullable=True)
    server_name      = Column(String, nullable=True)
    expires_at       = Column(String, nullable=True)
    invoice_id       = Column(String, nullable=True)
    payment_amount   = Column(Integer, nullable=True)
    paid_at          = Column(String, nullable=True)
    processing_error = Column(String, nullable=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    processed_at     = Column(String, nullable=True)


class Server(Base):
    __tablename__ = "servers"

    id         = Column(String, primary_key=True)
    name       = Column(String, nullable=False)
    base_url   = Column(String, nullable=False)
    token      = Column(String, default="")
    max_users  = Column(Integer, default=0)
    is_active  = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Release(Base):
    __tablename__ = "releases"

    id          = Column(String, primary_key=True)
    platform    = Column(String, nullable=False, index=True)   # android | windows
    version     = Column(String, nullable=False)
    filename    = Column(String, nullable=False)
    size_bytes  = Column(Integer, default=0)
    notes       = Column(Text, default="")
    uploaded_by = Column(String, nullable=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    action      = Column(String, nullable=False, index=True)
    entity_type = Column(String, nullable=False)
    entity_id   = Column(String, nullable=False, index=True)
    admin_id    = Column(String, ForeignKey("admins.id"), nullable=True)
    admin_username = Column(String, nullable=True)
    details     = Column(Text, default="{}")
    created_at  = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    admin = relationship("Admin", back_populates="audit_logs")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
