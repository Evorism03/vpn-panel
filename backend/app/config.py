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

    # Lava
    lava_api_key: str = ""
    lava_shop_id: str = ""
    lava_success_url: str = "http://localhost:5173/cabinet"
    lava_fail_url: str = "http://localhost:5173"

    # Pricing (RUB)
    price_1m: int = 199
    price_3m: int = 499
    price_6m: int = 899
    price_1y: int = 1499

    # Branding
    panel_name: str = "VPN Panel"
    panel_domain: str = "localhost"


@lru_cache
def get_settings() -> Settings:
    return Settings()
