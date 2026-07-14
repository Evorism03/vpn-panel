from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Auth
    secret_key: str = "dev-secret-change-me"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 30

    # First admin bootstrap
    admin_username: str = "admin"
    admin_password: str = "change-me"

    # AWG
    awg_config_path: str = "./data/awg0.conf"
    awg_interface: str = "awg0"
    awg_bin: str = "awg"
    awg_docker_container: str = ""
    awg_container_config_path: str = "/opt/amnezia/awg/awg0.conf"
    mock_awg: bool = True

    # Client config defaults
    server_endpoint: str = "127.0.0.1:51820"
    client_dns: str = "1.1.1.1"
    client_allowed_ips: str = "0.0.0.0/0,::/0"
    client_persistent_keepalive: int = 25

    # Data
    data_dir: str = "./data"
    db_path: str = "./data/vpn.db"
    releases_dir: str = "./data/releases"

    # Lava
    lava_api_key: str = ""
    lava_shop_id: str = ""
    lava_success_url: str = "http://localhost:5173/cabinet"
    lava_fail_url: str = "http://localhost:5173"

    # Pricing (RUB) — set to 0 to hide a term from the shop
    price_3d: int = 79
    price_7d: int = 129
    price_14d: int = 179
    price_1m: int = 199
    price_3m: int = 499
    price_6m: int = 899
    price_1y: int = 1499

    # SMTP email notifications (leave smtp_host empty to disable)
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_tls: bool = True

    # Fernet key for encrypting server tokens in DB.
    # Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    fernet_key: str = ""

    # WDTT (WireGuard over VK TURN) — leave empty to disable
    wdtt_server: str = ""    # IP:port, e.g. "1.2.3.4:56000"
    wdtt_password: str = ""  # master password set during deploy

    # Branding
    panel_name: str = "VPN Panel"
    panel_domain: str = "localhost"


@lru_cache
def get_settings() -> Settings:
    return Settings()
