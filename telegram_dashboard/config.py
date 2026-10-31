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
    # Local agent CLI (prompt on stdin, draft on stdout), e.g. `claude -p --tools ""`.
    ai_agent_command: str | None = None
    # Agent used when a project is selected: read-only tools, run with cwd = project.
    ai_agent_project_command: str = (
        "claude -p --tools Read,Grep,Glob --allowedTools Read,Grep,Glob"
    )
    # Interactive agent opened in Terminal for "Tạo task" (you approve each tool there).
    ai_task_command: str = "claude"
    ai_task_model: str = "claude-haiku-5-5"  # model for task sessions ("" = the CLI default)
    ai_task_effort: str = "medium"  # low|medium|high|xhigh|max ("" = the CLI default)
    # macOS banner for each live tag (NOTIFY=0 turns it off).
    notify: bool = True
    youtrack_url: str | None = None
    youtrack_token: str | None = field(default=None, repr=False)
    youtrack_project: str | None = None  # short name, e.g. "SDK"
    # Per-message consent grants before AI use (Telegram API Terms). Off only for personal use.
    ai_require_consent: bool = True

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
    def youtrack_configured(self) -> bool:
        return bool(self.youtrack_url and self.youtrack_token and self.youtrack_project)

    @property
    def ai_configured(self) -> bool:
        return bool(self.ai_agent_command) or bool(
            self.ai_base_url and self.ai_model and self.ai_api_key
        )

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
            ai_agent_command=env.get("AI_AGENT_COMMAND") or None,
            ai_agent_project_command=env.get("AI_AGENT_PROJECT_COMMAND")
            or Settings.ai_agent_project_command,
            ai_task_command=env.get("AI_TASK_COMMAND") or Settings.ai_task_command,
            ai_task_model=env["AI_TASK_MODEL"].strip() if "AI_TASK_MODEL" in env else Settings.ai_task_model,
            ai_task_effort=env["AI_TASK_EFFORT"].strip() if "AI_TASK_EFFORT" in env else Settings.ai_task_effort,
            notify=env.get("NOTIFY", "1").strip() != "0",
            youtrack_url=env.get("YOUTRACK_URL") or env.get("YT_URL") or None,
            youtrack_token=env.get("YOUTRACK_TOKEN") or env.get("YT_TOKEN") or None,
            youtrack_project=env.get("YOUTRACK_PROJECT") or None,
            ai_require_consent=env.get("AI_REQUIRE_CONSENT", "1").strip() != "0",
        )
