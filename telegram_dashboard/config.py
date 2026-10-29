import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOST = "127.0.0.1"
PORT = 8765


def _load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


@dataclass(frozen=True)
class Settings:
    root: Path = ROOT
    host: str = HOST
    port: int = PORT
    app_origin: str = f"http://{HOST}:{PORT}"
    telegram_api_id: int | None = None
    telegram_api_hash: str | None = None
    ai_base_url: str | None = None
    ai_model: str | None = None
    ai_api_key: str | None = field(default=None, repr=False)

    @property
    def data_dir(self) -> Path:
        return self.root / "data"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "dashboard.sqlite3"

    @property
    def session_path(self) -> Path:
        return self.data_dir / "account"  # Telethon appends .session

    @property
    def static_dir(self) -> Path:
        return self.root / "web" / "out"

    @property
    def host_header(self) -> str:
        return f"{self.host}:{self.port}"

    @property
    def telegram_configured(self) -> bool:
        return self.telegram_api_id is not None and bool(self.telegram_api_hash)

    @property
    def ai_configured(self) -> bool:
        return bool(self.ai_base_url and self.ai_model and self.ai_api_key)

    def ensure_data_dir(self) -> None:
        self.data_dir.mkdir(mode=0o700, exist_ok=True)
        self.data_dir.chmod(0o700)

    @classmethod
    def from_env(cls, root: Path = ROOT) -> Settings:
        _load_dotenv(root / ".env")
        env = os.environ
        api_id = env.get("TELEGRAM_API_ID", "").strip()
        return cls(
            root=root,
            app_origin=env.get("APP_ORIGIN") or f"http://{HOST}:{PORT}",
            telegram_api_id=int(api_id) if api_id.isdigit() else None,
            telegram_api_hash=env.get("TELEGRAM_API_HASH") or None,
            ai_base_url=env.get("AI_BASE_URL") or None,
            ai_model=env.get("AI_MODEL") or None,
            ai_api_key=env.get("AI_API_KEY") or None,
        )
