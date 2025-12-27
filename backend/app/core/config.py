from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path
from typing import List
from dotenv import load_dotenv

# Load .env file with override=True to ensure .env values take precedence
env_path = Path(__file__).parent.parent.parent / ".env"
load_dotenv(dotenv_path=env_path, override=True)


class Settings(BaseSettings):
    app_name: str = "OpenAlgo Flow"
    debug: bool = False

    # Server
    host: str = "127.0.0.1"
    port: int = 8000

    # Database
    database_url: str = "sqlite+aiosqlite:///./openalgo_flow.db"

    # CORS / Frontend
    frontend_url: str = "http://localhost:5173"
    cors_origins: List[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # API
    api_prefix: str = "/api"

    # Webhook
    webhook_host_url: str = "http://127.0.0.1:8000"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()

# Ensure data directory exists
DATA_DIR = Path(__file__).parent.parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)
